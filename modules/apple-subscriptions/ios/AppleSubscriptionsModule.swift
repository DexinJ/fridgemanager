import ExpoModulesCore
import Foundation
import StoreKit

private let subscriptionChangedEvent = "onSubscriptionStatusChanged"

public final class AppleSubscriptionsModule: Module {
  private let stateQueue = DispatchQueue(
    label: "com.chilltech.pantrio.apple-subscriptions"
  )
  private var configuredProductIDs: [String] = []
  private var isObserving = false
  private var refreshGeneration = 0
  private var transactionUpdatesTask: Task<Void, Never>?
  private var statusUpdatesTask: Task<Void, Never>?
  private var refreshTask: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("AppleSubscriptions")

    Events(subscriptionChangedEvent)

    Function("configure") { (productIDs: [String]) in
      let normalizedIDs = Self.normalizedProductIDs(productIDs)
      self.updateConfiguration(normalizedIDs)
    }

    AsyncFunction("getCurrentStatus") { (productIDs: [String]) async -> [String: Any] in
      let normalizedIDs = Self.normalizedProductIDs(productIDs)
      self.updateConfiguration(normalizedIDs)
      return await Self.makeSnapshot(productIDs: normalizedIDs)
    }

    OnStartObserving(subscriptionChangedEvent) {
      self.beginObserving()
    }

    OnStopObserving(subscriptionChangedEvent) {
      self.endObserving()
    }

    OnAppBecomesActive {
      self.scheduleStatusEvent(reason: "app_became_active")
    }

    OnDestroy {
      self.endObserving()
    }
  }

  private func updateConfiguration(_ productIDs: [String]) {
    stateQueue.sync {
      guard productIDs != configuredProductIDs else {
        return
      }

      configuredProductIDs = productIDs
      if isObserving {
        scheduleStatusEventLocked(reason: "configuration_changed")
      }
    }
  }

  private func beginObserving() {
    stateQueue.async {
      self.isObserving = true
      self.startUpdateListenersLocked()
    }
  }

  private func startUpdateListenersLocked() {
    if transactionUpdatesTask == nil {
      transactionUpdatesTask = Task { [weak self] in
        for await _ in StoreKit.Transaction.updates {
          guard !Task.isCancelled else {
            return
          }
          self?.scheduleStatusEvent(reason: "transaction_updated")
        }
      }
    }

    if statusUpdatesTask == nil {
      statusUpdatesTask = Task { [weak self] in
        for await _ in Product.SubscriptionInfo.Status.updates {
          guard !Task.isCancelled else {
            return
          }
          self?.scheduleStatusEvent(reason: "subscription_status_updated")
        }
      }
    }
  }

  private func endObserving() {
    stateQueue.async {
      self.isObserving = false
      self.stopUpdateListenersLocked()
    }
  }

  private func stopUpdateListenersLocked() {
    refreshGeneration += 1
    transactionUpdatesTask?.cancel()
    transactionUpdatesTask = nil
    statusUpdatesTask?.cancel()
    statusUpdatesTask = nil
    refreshTask?.cancel()
    refreshTask = nil
  }

  private func scheduleStatusEvent(reason: String) {
    stateQueue.async { [weak self] in
      self?.scheduleStatusEventLocked(reason: reason)
    }
  }

  private func scheduleStatusEventLocked(reason: String) {
    guard isObserving else {
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

  private func publishStatusEvent(
    _ snapshot: [String: Any],
    generation: Int
  ) {
    stateQueue.async { [weak self] in
      guard let self,
            self.isObserving,
            self.refreshGeneration == generation else {
        return
      }

      self.sendEvent(subscriptionChangedEvent, snapshot)
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
