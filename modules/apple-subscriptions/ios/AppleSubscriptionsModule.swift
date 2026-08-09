import ExpoModulesCore
import Foundation
import StoreKit
import UIKit

private let subscriptionChangedEvent = "onSubscriptionStatusChanged"
private let transactionChangedEvent = "onAppleTransaction"

public final class AppleSubscriptionsModule: Module {
  private let stateQueue = DispatchQueue(
    label: "com.chilltech.pantrio.apple-subscriptions"
  )
  private var configuredProductIDs: [String] = []
  private var isObservingStatus = false
  private var isObservingTransactions = false
  private var refreshGeneration = 0
  private var transactionUpdatesTask: Task<Void, Never>?
  private var statusUpdatesTask: Task<Void, Never>?
  private var refreshTask: Task<Void, Never>?
  private var unfinishedRefreshTask: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("AppleSubscriptions")

    Events(subscriptionChangedEvent, transactionChangedEvent)

    Function("configure") { (productIDs: [String]) in
      let normalizedIDs = Self.normalizedProductIDs(productIDs)
      self.updateConfiguration(normalizedIDs)
    }

    AsyncFunction("getCurrentStatus") { (productIDs: [String]) async -> [String: Any] in
      let normalizedIDs = Self.normalizedProductIDs(productIDs)
      self.updateConfiguration(normalizedIDs)
      return await Self.makeSnapshot(productIDs: normalizedIDs)
    }

    AsyncFunction("getProducts") { (productIDs: [String]) async throws -> [[String: Any]] in
      let normalizedIDs = Self.normalizedProductIDs(productIDs)
      self.updateConfiguration(normalizedIDs)
      return try await Self.loadProducts(productIDs: normalizedIDs)
    }

    AsyncFunction("purchase") {
      (productID: String, appAccountToken: String) async throws -> [String: Any] in
      let normalizedProductID = productID.trimmingCharacters(
        in: .whitespacesAndNewlines
      )
      guard !normalizedProductID.isEmpty else {
        throw AppleSubscriptionBridgeError.invalidProductID
      }

      let configuredIDs = self.configuredProductIDsSnapshot()
      guard configuredIDs.contains(normalizedProductID) else {
        throw AppleSubscriptionBridgeError.productNotConfigured(normalizedProductID)
      }
      guard let accountToken = UUID(uuidString: appAccountToken) else {
        throw AppleSubscriptionBridgeError.invalidAppAccountToken
      }

      let products = try await Product.products(for: [normalizedProductID])
      guard let product = products.first(where: { $0.id == normalizedProductID }) else {
        throw AppleSubscriptionBridgeError.productUnavailable(normalizedProductID)
      }
      guard product.type == .autoRenewable else {
        throw AppleSubscriptionBridgeError.unsupportedProductType(normalizedProductID)
      }

      let purchaseResult = try await Self.purchase(
        product: product,
        appAccountToken: accountToken
      )

      switch purchaseResult {
      case .success(let verificationResult):
        let evidence = await Self.makeEvidence(
          verificationResult,
          source: "purchase"
        )
        let unfinishedIDs = await Self.unfinishedTransactionIDs(
          productIDs: configuredIDs
        )
        let snapshot = await Self.makeSnapshot(productIDs: configuredIDs)
        return Self.outcome(
          "purchased",
          evidence: [evidence],
          unfinishedTransactionIDs: unfinishedIDs,
          snapshot: snapshot
        )

      case .pending:
        return Self.outcome(
          "pending",
          snapshot: await Self.makeSnapshot(productIDs: configuredIDs)
        )

      case .userCancelled:
        return Self.outcome(
          "cancelled",
          snapshot: await Self.makeSnapshot(productIDs: configuredIDs)
        )

      @unknown default:
        throw AppleSubscriptionBridgeError.unknownPurchaseResult
      }
    }

    AsyncFunction("restorePurchases") { (productIDs: [String]) async throws -> [String: Any] in
      let normalizedIDs = Self.normalizedProductIDs(productIDs)
      self.updateConfiguration(normalizedIDs)

      try await AppStore.sync()

      let evidence = await Self.currentAndUnfinishedEvidence(
        productIDs: normalizedIDs,
        source: "restore"
      )
      let unfinishedIDs = await Self.unfinishedTransactionIDs(
        productIDs: normalizedIDs
      )
      let snapshot = await Self.makeSnapshot(productIDs: normalizedIDs)
      return Self.outcome(
        "restored",
        evidence: evidence,
        unfinishedTransactionIDs: unfinishedIDs,
        snapshot: snapshot
      )
    }

    AsyncFunction("getUnfinishedTransactions") { () async -> [String: Any] in
      let productIDs = self.configuredProductIDsSnapshot()
      let evidence = await Self.unfinishedEvidence(
        productIDs: productIDs,
        source: "unfinished_request"
      )
      return Self.outcome(
        "unfinished",
        evidence: evidence,
        unfinishedTransactionIDs: Self.transactionIDs(from: evidence)
      )
    }

    AsyncFunction("finishTransactions") { (transactionIDs: [String]) async -> [String: Any] in
      let requestedIDs = Set(
        transactionIDs
          .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
          .filter { !$0.isEmpty }
      )
      let productIDs = self.configuredProductIDsSnapshot()
      let finishedIDs = await Self.finishTransactions(
        transactionIDs: requestedIDs,
        productIDs: productIDs
      )
      let remainingIDs = await Self.unfinishedTransactionIDs(
        productIDs: productIDs
      )
      let missingIDs = requestedIDs.subtracting(finishedIDs).sorted()
      let snapshot = await Self.makeSnapshot(productIDs: productIDs)

      var result = Self.outcome(
        "finished",
        unfinishedTransactionIDs: remainingIDs,
        snapshot: snapshot
      )
      result["finishedTransactionIds"] = finishedIDs.sorted()
      result["notFoundTransactionIds"] = missingIDs
      return result
    }

    OnStartObserving(subscriptionChangedEvent) {
      self.beginStatusObserving()
    }

    OnStopObserving(subscriptionChangedEvent) {
      self.endStatusObserving()
    }

    OnStartObserving(transactionChangedEvent) {
      self.beginTransactionObserving()
    }

    OnStopObserving(transactionChangedEvent) {
      self.endTransactionObserving()
    }

    OnAppBecomesActive {
      self.scheduleStatusEvent(reason: "app_became_active")
      self.scheduleUnfinishedEvent(reason: "app_became_active")
    }

    OnDestroy {
      self.endAllObserving()
    }
  }

  private func updateConfiguration(_ productIDs: [String]) {
    stateQueue.sync {
      guard productIDs != configuredProductIDs else {
        return
      }

      configuredProductIDs = productIDs
      if isObservingStatus {
        scheduleStatusEventLocked(reason: "configuration_changed")
      }
      if isObservingTransactions {
        scheduleUnfinishedEventLocked(reason: "configuration_changed")
      }
    }
  }

  private func configuredProductIDsSnapshot() -> [String] {
    stateQueue.sync { configuredProductIDs }
  }

  private func beginStatusObserving() {
    stateQueue.async {
      self.isObservingStatus = true
      self.reconcileUpdateListenersLocked()
      self.scheduleStatusEventLocked(reason: "listener_started")
    }
  }

  private func endStatusObserving() {
    stateQueue.async {
      self.isObservingStatus = false
      self.refreshGeneration += 1
      self.refreshTask?.cancel()
      self.refreshTask = nil
      self.reconcileUpdateListenersLocked()
    }
  }

  private func beginTransactionObserving() {
    stateQueue.async {
      self.isObservingTransactions = true
      self.reconcileUpdateListenersLocked()
      self.scheduleUnfinishedEventLocked(reason: "listener_started")
    }
  }

  private func endTransactionObserving() {
    stateQueue.async {
      self.isObservingTransactions = false
      self.unfinishedRefreshTask?.cancel()
      self.unfinishedRefreshTask = nil
      self.reconcileUpdateListenersLocked()
    }
  }

  private func endAllObserving() {
    stateQueue.async {
      self.isObservingStatus = false
      self.isObservingTransactions = false
      self.stopAllUpdateListenersLocked()
    }
  }

  private func reconcileUpdateListenersLocked() {
    if (isObservingStatus || isObservingTransactions) && transactionUpdatesTask == nil {
      transactionUpdatesTask = Task { [weak self] in
        for await verificationResult in StoreKit.Transaction.updates {
          guard !Task.isCancelled else {
            return
          }
          await self?.handleTransactionUpdate(verificationResult)
        }
      }
    } else if !isObservingStatus && !isObservingTransactions {
      transactionUpdatesTask?.cancel()
      transactionUpdatesTask = nil
    }

    if isObservingStatus && statusUpdatesTask == nil {
      statusUpdatesTask = Task { [weak self] in
        for await _ in Product.SubscriptionInfo.Status.updates {
          guard !Task.isCancelled else {
            return
          }
          self?.scheduleStatusEvent(reason: "subscription_status_updated")
        }
      }
    } else if !isObservingStatus {
      statusUpdatesTask?.cancel()
      statusUpdatesTask = nil
    }
  }

  private func handleTransactionUpdate(
    _ verificationResult: VerificationResult<StoreKit.Transaction>
  ) async {
    let productIDs = configuredProductIDsSnapshot()
    let transaction = Self.transaction(from: verificationResult)
    guard Self.matchesCatalog(transaction, productIDs: productIDs) else {
      return
    }

    let evidence = await Self.makeEvidence(
      verificationResult,
      source: "transaction_update"
    )
    publishTransactionOutcome(
      Self.outcome(
        "transaction_updated",
        evidence: [evidence],
        unfinishedTransactionIDs: Self.transactionIDs(from: [evidence])
      )
    )
    scheduleStatusEvent(reason: "transaction_updated")
  }

  private func stopAllUpdateListenersLocked() {
    refreshGeneration += 1
    transactionUpdatesTask?.cancel()
    transactionUpdatesTask = nil
    statusUpdatesTask?.cancel()
    statusUpdatesTask = nil
    refreshTask?.cancel()
    refreshTask = nil
    unfinishedRefreshTask?.cancel()
    unfinishedRefreshTask = nil
  }

  private func scheduleStatusEvent(reason: String) {
    stateQueue.async { [weak self] in
      self?.scheduleStatusEventLocked(reason: reason)
    }
  }

  private func scheduleStatusEventLocked(reason: String) {
    guard isObservingStatus else {
      return
    }

    refreshTask?.cancel()
    let productIDs = configuredProductIDs
    refreshGeneration += 1
    let generation = refreshGeneration

    refreshTask = Task { [weak self] in
      var snapshot = await Self.makeSnapshot(productIDs: productIDs)
      guard !Task.isCancelled else {
        return
      }

      snapshot["reason"] = reason
      self?.publishStatusEvent(snapshot, generation: generation)
    }
  }

  private func scheduleUnfinishedEvent(reason: String) {
    stateQueue.async { [weak self] in
      self?.scheduleUnfinishedEventLocked(reason: reason)
    }
  }

  private func scheduleUnfinishedEventLocked(reason: String) {
    guard isObservingTransactions else {
      return
    }

    unfinishedRefreshTask?.cancel()
    let productIDs = configuredProductIDs
    unfinishedRefreshTask = Task { [weak self] in
      let evidence = await Self.unfinishedEvidence(
        productIDs: productIDs,
        source: reason
      )
      guard !Task.isCancelled, !evidence.isEmpty else {
        return
      }

      self?.publishTransactionOutcome(
        Self.outcome(
          "unfinished",
          evidence: evidence,
          unfinishedTransactionIDs: Self.transactionIDs(from: evidence)
        )
      )
    }
  }

  private func publishTransactionOutcome(_ result: [String: Any]) {
    stateQueue.async { [weak self] in
      guard let self, self.isObservingTransactions else {
        return
      }
      self.sendEvent(transactionChangedEvent, result)
    }
  }

  private func publishStatusEvent(
    _ snapshot: [String: Any],
    generation: Int
  ) {
    stateQueue.async { [weak self] in
      guard let self,
            self.isObservingStatus,
            self.refreshGeneration == generation else {
        return
      }

      self.sendEvent(subscriptionChangedEvent, snapshot)
    }
  }

  private static func loadProducts(
    productIDs: [String]
  ) async throws -> [[String: Any]] {
    guard !productIDs.isEmpty else {
      return []
    }

    let products = try await Product.products(for: productIDs)
    let productsByID = Dictionary(uniqueKeysWithValues: products.map { ($0.id, $0) })

    return productIDs.compactMap { productID in
      guard let product = productsByID[productID],
            product.type == .autoRenewable,
            let subscription = product.subscription else {
        return nil
      }

      let period = subscription.subscriptionPeriod
      return [
        "productId": product.id,
        "displayName": product.displayName,
        "description": product.description,
        "displayPrice": product.displayPrice,
        "price": NSDecimalNumber(decimal: product.price).stringValue,
        "type": "auto_renewable",
        "subscriptionGroupId": subscription.subscriptionGroupID,
        "subscriptionGroupDisplayName": subscription.groupDisplayName,
        "groupLevel": subscription.groupLevel,
        "period": [
          "value": period.value,
          "unit": normalizedPeriodUnit(period.unit),
        ],
        "isFamilyShareable": product.isFamilyShareable,
      ]
    }
  }

  @MainActor
  private static func purchase(
    product: Product,
    appAccountToken: UUID
  ) async throws -> Product.PurchaseResult {
    let windowScenes = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
    guard let windowScene = windowScenes.first(where: {
      $0.activationState == .foregroundActive
    }) ?? windowScenes.first else {
      throw AppleSubscriptionBridgeError.noActiveWindowScene
    }

    return try await product.purchase(
      confirmIn: windowScene,
      options: [.appAccountToken(appAccountToken)]
    )
  }

  private static func makeEvidence(
    _ verificationResult: VerificationResult<StoreKit.Transaction>,
    source: String
  ) async -> [String: Any] {
    let transaction: StoreKit.Transaction
    let localVerification: String
    let localVerificationError: String?

    switch verificationResult {
    case .verified(let verifiedTransaction):
      transaction = verifiedTransaction
      localVerification = "verified"
      localVerificationError = nil
    case .unverified(let unverifiedTransaction, let error):
      transaction = unverifiedTransaction
      localVerification = "unverified"
      localVerificationError = error.localizedDescription
    }

    let renewalEvidence = await signedRenewalEvidence(for: transaction)
    return [
      "signedTransactionInfo": verificationResult.jwsRepresentation,
      "signedRenewalInfo": bridgeValue(renewalEvidence.jws),
      "transactionId": String(transaction.id),
      "originalTransactionId": String(transaction.originalID),
      "productId": transaction.productID,
      "subscriptionGroupId": bridgeValue(transaction.subscriptionGroupID),
      "appAccountToken": bridgeValue(
        transaction.appAccountToken?.uuidString.lowercased()
      ),
      "purchaseDate": iso8601String(transaction.purchaseDate),
      "expirationDate": bridgeValue(transaction.expirationDate.map(iso8601String)),
      "revocationDate": bridgeValue(transaction.revocationDate.map(iso8601String)),
      "localVerification": localVerification,
      "localVerificationError": bridgeValue(localVerificationError),
      "renewalLocalVerification": bridgeValue(renewalEvidence.localVerification),
      "source": source,
    ]
  }

  private static func signedRenewalEvidence(
    for transaction: StoreKit.Transaction
  ) async -> (jws: String?, localVerification: String?) {
    guard transaction.productType == .autoRenewable,
          let subscriptionStatus = await transaction.subscriptionStatus else {
      return (nil, nil)
    }

    let verification: String
    switch subscriptionStatus.renewalInfo {
    case .verified:
      verification = "verified"
    case .unverified:
      verification = "unverified"
    }
    return (subscriptionStatus.renewalInfo.jwsRepresentation, verification)
  }

  private static func currentAndUnfinishedEvidence(
    productIDs: [String],
    source: String
  ) async -> [[String: Any]] {
    var evidenceByTransactionID: [String: [String: Any]] = [:]

    for await verificationResult in StoreKit.Transaction.currentEntitlements {
      let transaction = transaction(from: verificationResult)
      guard matchesCatalog(transaction, productIDs: productIDs) else {
        continue
      }
      evidenceByTransactionID[String(transaction.id)] = await makeEvidence(
        verificationResult,
        source: source
      )
    }

    for await verificationResult in StoreKit.Transaction.unfinished {
      let transaction = transaction(from: verificationResult)
      guard matchesCatalog(transaction, productIDs: productIDs) else {
        continue
      }
      evidenceByTransactionID[String(transaction.id)] = await makeEvidence(
        verificationResult,
        source: source
      )
    }

    return evidenceByTransactionID.values.sorted {
      ($0["transactionId"] as? String ?? "") <
        ($1["transactionId"] as? String ?? "")
    }
  }

  private static func unfinishedEvidence(
    productIDs: [String],
    source: String
  ) async -> [[String: Any]] {
    var evidence: [[String: Any]] = []
    for await verificationResult in StoreKit.Transaction.unfinished {
      let transaction = transaction(from: verificationResult)
      guard matchesCatalog(transaction, productIDs: productIDs) else {
        continue
      }
      evidence.append(
        await makeEvidence(verificationResult, source: source)
      )
    }
    return evidence.sorted {
      ($0["transactionId"] as? String ?? "") <
        ($1["transactionId"] as? String ?? "")
    }
  }

  private static func unfinishedTransactionIDs(
    productIDs: [String]
  ) async -> [String] {
    var transactionIDs = Set<String>()
    for await verificationResult in StoreKit.Transaction.unfinished {
      let transaction = transaction(from: verificationResult)
      guard matchesCatalog(transaction, productIDs: productIDs) else {
        continue
      }
      transactionIDs.insert(String(transaction.id))
    }
    return transactionIDs.sorted()
  }

  private static func finishTransactions(
    transactionIDs: Set<String>,
    productIDs: [String]
  ) async -> Set<String> {
    guard !transactionIDs.isEmpty else {
      return []
    }

    var finishedIDs = Set<String>()
    for await verificationResult in StoreKit.Transaction.unfinished {
      let transaction = transaction(from: verificationResult)
      let transactionID = String(transaction.id)
      guard transactionIDs.contains(transactionID),
            matchesCatalog(transaction, productIDs: productIDs) else {
        continue
      }

      await transaction.finish()
      finishedIDs.insert(transactionID)
    }
    return finishedIDs
  }

  private static func transaction(
    from verificationResult: VerificationResult<StoreKit.Transaction>
  ) -> StoreKit.Transaction {
    switch verificationResult {
    case .verified(let transaction), .unverified(let transaction, _):
      return transaction
    }
  }

  private static func matchesCatalog(
    _ transaction: StoreKit.Transaction,
    productIDs: [String]
  ) -> Bool {
    transaction.productType == .autoRenewable &&
      productIDs.contains(transaction.productID)
  }

  private static func transactionIDs(
    from evidence: [[String: Any]]
  ) -> [String] {
    Array(
      Set(evidence.compactMap { $0["transactionId"] as? String })
    ).sorted()
  }

  private static func outcome(
    _ outcome: String,
    evidence: [[String: Any]] = [],
    unfinishedTransactionIDs: [String] = [],
    snapshot: [String: Any]? = nil
  ) -> [String: Any] {
    var result: [String: Any] = [
      "outcome": outcome,
      "evidence": evidence,
      "unfinishedTransactionIds": unfinishedTransactionIDs,
    ]
    if let snapshot {
      result["snapshot"] = snapshot
    }
    return result
  }

  private static func normalizedPeriodUnit(
    _ unit: Product.SubscriptionPeriod.Unit
  ) -> String {
    switch unit {
    case .day:
      return "day"
    case .week:
      return "week"
    case .month:
      return "month"
    case .year:
      return "year"
    @unknown default:
      return "unknown"
    }
  }

  private static func makeSnapshot(productIDs: [String]) async -> [String: Any] {
    var discoveredProductIDs = Set(productIDs)
    var latestTransactionsByGroup: [String: StoreKit.Transaction] = [:]
    var sawUnverifiedSubscription = false

    for await verificationResult in StoreKit.Transaction.all {
      let transaction: StoreKit.Transaction
      switch verificationResult {
      case .verified(let verifiedTransaction):
        transaction = verifiedTransaction
      case .unverified(let unverifiedTransaction, _):
        transaction = unverifiedTransaction
        if transaction.productType == .autoRenewable {
          sawUnverifiedSubscription = true
        }
      }

      guard transaction.productType == .autoRenewable else {
        continue
      }

      discoveredProductIDs.insert(transaction.productID)
      guard let groupID = transaction.subscriptionGroupID else {
        continue
      }

      if let current = latestTransactionsByGroup[groupID],
         current.purchaseDate >= transaction.purchaseDate {
        continue
      }
      latestTransactionsByGroup[groupID] = transaction
    }

    var productMetadata: [String: SubscriptionProductMetadata] = [:]
    var productsByGroup: [String: Product] = [:]
    var loadedProductIDs = Set<String>()
    var productLoadError: Error?

    if !discoveredProductIDs.isEmpty {
      do {
        let products = try await Product.products(for: Array(discoveredProductIDs))
        for product in products where product.type == .autoRenewable {
          guard let subscription = product.subscription else {
            continue
          }

          loadedProductIDs.insert(product.id)

          productMetadata[product.id] = SubscriptionProductMetadata(
            displayName: product.displayName,
            groupID: subscription.subscriptionGroupID,
            groupLevel: subscription.groupLevel
          )

          if productsByGroup[subscription.subscriptionGroupID] == nil {
            productsByGroup[subscription.subscriptionGroupID] = product
          }
        }
      } catch {
        productLoadError = error
      }
    }

    var records: [SubscriptionRecord] = []
    var queriedGroupIDs = Set<String>()
    var failedGroupMessages: [String: String] = [:]

    for groupID in productsByGroup.keys.sorted() {
      guard let subscription = productsByGroup[groupID]?.subscription else {
        continue
      }

      do {
        let statuses = try await subscription.status
        if !statuses.isEmpty || latestTransactionsByGroup[groupID] == nil {
          queriedGroupIDs.insert(groupID)
        }
        records.append(
          contentsOf: statuses.map {
            SubscriptionRecord(
              status: $0,
              productMetadata: productMetadata
            )
          }
        )
      } catch {
        failedGroupMessages[groupID] = error.localizedDescription
      }
    }

    // A configured product can be unavailable or removed from sale. Fall back
    // to the latest known transaction so existing customers are still checked.
    for (groupID, transaction) in latestTransactionsByGroup
      where !queriedGroupIDs.contains(groupID) {
      if let status = await transaction.subscriptionStatus {
        records.append(
          SubscriptionRecord(
            status: status,
            productMetadata: productMetadata
          )
        )
        failedGroupMessages.removeValue(forKey: groupID)
      } else {
        failedGroupMessages[groupID] =
          "StoreKit did not return a status for this subscription group."
      }
    }

    records = deduplicatedAndSorted(records)
    let primary = records.first
    let verifiedPrimary = primary?.isVerified == true ? primary : nil

    let unresolvedConfiguredProductIDs = Set(productIDs)
      .subtracting(loadedProductIDs)
    let containsUnverifiedStatus = records.contains { !$0.isVerified }
    let statusIsIncomplete =
      !failedGroupMessages.isEmpty ||
      !unresolvedConfiguredProductIDs.isEmpty ||
      (productLoadError != nil && !productIDs.isEmpty) ||
      containsUnverifiedStatus ||
      (sawUnverifiedSubscription && records.isEmpty)
    let metadataIsIncomplete =
      productLoadError != nil &&
      productIDs.isEmpty &&
      !discoveredProductIDs.isEmpty

    var errorMessage: String?
    if statusIsIncomplete {
      if containsUnverifiedStatus || (sawUnverifiedSubscription && records.isEmpty) {
        errorMessage = "Apple returned subscription data that could not be verified."
      } else if !unresolvedConfiguredProductIDs.isEmpty {
        errorMessage = "One or more configured Apple subscription products could not be loaded."
      } else {
        errorMessage = "Not every Apple subscription group could be refreshed."
      }
    } else if metadataIsIncomplete {
      errorMessage = "Subscription status was checked, but product details could not be loaded."
    }

    let overallStatus: String
    if primary?.isEntitled == true {
      overallStatus = primary?.status ?? "subscribed"
    } else if statusIsIncomplete {
      overallStatus = "unknown"
    } else if let primary {
      overallStatus = primary.isVerified ? primary.status : "unknown"
    } else {
      overallStatus = "not_subscribed"
    }

    return [
      "status": overallStatus,
      "isEntitled": primary?.isEntitled ?? false,
      "productId": bridgeValue(verifiedPrimary?.productID),
      "displayName": bridgeValue(verifiedPrimary?.displayName),
      "subscriptionGroupId": bridgeValue(verifiedPrimary?.subscriptionGroupID),
      "expirationDate": bridgeValue(verifiedPrimary?.expirationDate),
      "willAutoRenew": verifiedPrimary?.willAutoRenew ?? false,
      "subscriptions": records.map(\.dictionary),
      "checkedAt": iso8601String(Date()),
      "isPartial": statusIsIncomplete || metadataIsIncomplete,
      "error": bridgeValue(errorMessage),
    ]
  }

  private static func deduplicatedAndSorted(
    _ records: [SubscriptionRecord]
  ) -> [SubscriptionRecord] {
    var uniqueRecords: [String: SubscriptionRecord] = [:]

    for record in records {
      let key = [
        record.subscriptionGroupID,
        record.originalTransactionID,
        record.productID,
      ].joined(separator: "|")

      guard let existing = uniqueRecords[key] else {
        uniqueRecords[key] = record
        continue
      }

      if record.sortsBefore(existing) {
        uniqueRecords[key] = record
      }
    }

    return uniqueRecords.values.sorted { $0.sortsBefore($1) }
  }

  private static func normalizedProductIDs(_ productIDs: [String]) -> [String] {
    Array(
      Set(
        productIDs
          .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
          .filter { !$0.isEmpty }
      )
    ).sorted()
  }
}

private enum AppleSubscriptionBridgeError: LocalizedError {
  case invalidProductID
  case productNotConfigured(String)
  case invalidAppAccountToken
  case productUnavailable(String)
  case unsupportedProductType(String)
  case noActiveWindowScene
  case unknownPurchaseResult

  var errorDescription: String? {
    switch self {
    case .invalidProductID:
      return "A subscription product ID is required."
    case .productNotConfigured(let productID):
      return "The subscription product \(productID) is not in the current server catalog."
    case .invalidAppAccountToken:
      return "The backend app account token must be a valid UUID."
    case .productUnavailable(let productID):
      return "Apple did not return the subscription product \(productID)."
    case .unsupportedProductType(let productID):
      return "The product \(productID) is not an auto-renewable subscription."
    case .noActiveWindowScene:
      return "A foreground app window is required to present the Apple purchase sheet."
    case .unknownPurchaseResult:
      return "Apple returned an unsupported purchase result."
    }
  }
}

private struct SubscriptionProductMetadata {
  let displayName: String
  let groupID: String
  let groupLevel: Int
}

private struct SubscriptionRecord {
  let status: String
  let isVerified: Bool
  let isEntitled: Bool
  let productID: String
  let displayName: String?
  let subscriptionGroupID: String
  let groupLevel: Int
  let transactionID: String
  let originalTransactionID: String
  let purchaseDate: String
  let expirationDate: String?
  let revocationDate: String?
  let willAutoRenew: Bool
  let nextProductID: String?
  let gracePeriodExpirationDate: String?
  let ownershipType: String
  let appAccountToken: String?

  init(
    status subscriptionStatus: Product.SubscriptionInfo.Status,
    productMetadata: [String: SubscriptionProductMetadata]
  ) {
    let transaction: StoreKit.Transaction
    let transactionIsVerified: Bool

    switch subscriptionStatus.transaction {
    case .verified(let verifiedTransaction):
      transaction = verifiedTransaction
      transactionIsVerified = true
    case .unverified(let unverifiedTransaction, _):
      transaction = unverifiedTransaction
      transactionIsVerified = false
    }

    let renewalInfo: Product.SubscriptionInfo.RenewalInfo?
    let renewalInfoIsVerified: Bool

    switch subscriptionStatus.renewalInfo {
    case .verified(let verifiedRenewalInfo):
      renewalInfo = verifiedRenewalInfo
      renewalInfoIsVerified = true
    case .unverified:
      renewalInfo = nil
      renewalInfoIsVerified = false
    }

    let normalizedStatus = Self.normalizedStatus(subscriptionStatus.state)
    let fullyVerified = transactionIsVerified && renewalInfoIsVerified
    let metadata = productMetadata[transaction.productID]

    status = normalizedStatus
    isVerified = fullyVerified
    isEntitled = fullyVerified &&
      (normalizedStatus == "subscribed" || normalizedStatus == "in_grace_period")
    productID = transaction.productID
    displayName = metadata?.displayName
    subscriptionGroupID = transaction.subscriptionGroupID ?? metadata?.groupID ?? ""
    groupLevel = metadata?.groupLevel ?? 0
    transactionID = String(transaction.id)
    originalTransactionID = String(transaction.originalID)
    purchaseDate = iso8601String(transaction.purchaseDate)
    expirationDate = transaction.expirationDate.map(iso8601String)
    revocationDate = transaction.revocationDate.map(iso8601String)
    willAutoRenew = renewalInfo?.willAutoRenew ?? false
    nextProductID = renewalInfo?.autoRenewPreference
    gracePeriodExpirationDate = renewalInfo?.gracePeriodExpirationDate.map(iso8601String)
    ownershipType = Self.normalizedOwnershipType(transaction.ownershipType)
    appAccountToken = transaction.appAccountToken?.uuidString
  }

  var dictionary: [String: Any] {
    [
      "status": status,
      "isVerified": isVerified,
      "isEntitled": isEntitled,
      "productId": productID,
      "displayName": bridgeValue(displayName),
      "subscriptionGroupId": subscriptionGroupID,
      "groupLevel": groupLevel,
      "transactionId": transactionID,
      "originalTransactionId": originalTransactionID,
      "purchaseDate": purchaseDate,
      "expirationDate": bridgeValue(expirationDate),
      "revocationDate": bridgeValue(revocationDate),
      "willAutoRenew": willAutoRenew,
      "nextProductId": bridgeValue(nextProductID),
      "gracePeriodExpirationDate": bridgeValue(gracePeriodExpirationDate),
      "ownershipType": ownershipType,
      "appAccountToken": bridgeValue(appAccountToken),
    ]
  }

  func sortsBefore(_ other: SubscriptionRecord) -> Bool {
    if isEntitled != other.isEntitled {
      return isEntitled
    }
    if isVerified != other.isVerified {
      return isVerified
    }

    let ownStatusPriority = Self.statusPriority(status)
    let otherStatusPriority = Self.statusPriority(other.status)
    if ownStatusPriority != otherStatusPriority {
      return ownStatusPriority > otherStatusPriority
    }

    let ownLevel = groupLevel > 0 ? groupLevel : Int.max
    let otherLevel = other.groupLevel > 0 ? other.groupLevel : Int.max
    if ownLevel != otherLevel {
      return ownLevel < otherLevel
    }

    if expirationDate != other.expirationDate {
      return (expirationDate ?? "") > (other.expirationDate ?? "")
    }
    if purchaseDate != other.purchaseDate {
      return purchaseDate > other.purchaseDate
    }
    return productID < other.productID
  }

  private static func normalizedStatus(
    _ state: Product.SubscriptionInfo.RenewalState
  ) -> String {
    switch state {
    case .subscribed:
      return "subscribed"
    case .inGracePeriod:
      return "in_grace_period"
    case .inBillingRetryPeriod:
      return "in_billing_retry_period"
    case .expired:
      return "expired"
    case .revoked:
      return "revoked"
    default:
      return "unknown"
    }
  }

  private static func normalizedOwnershipType(
    _ ownershipType: StoreKit.Transaction.OwnershipType
  ) -> String {
    switch ownershipType {
    case .purchased:
      return "purchased"
    case .familyShared:
      return "family_shared"
    default:
      return "unknown"
    }
  }

  private static func statusPriority(_ status: String) -> Int {
    switch status {
    case "subscribed":
      return 5
    case "in_grace_period":
      return 4
    case "in_billing_retry_period":
      return 3
    case "expired":
      return 2
    case "revoked":
      return 1
    default:
      return 0
    }
  }
}

private func bridgeValue(_ value: String?) -> Any {
  value ?? NSNull()
}

private func iso8601String(_ date: Date) -> String {
  ISO8601DateFormatter().string(from: date)
}
