import ExpoModulesCore
import UIKit

#if canImport(FoundationModels)
import FoundationModels

@available(iOS 26.0, *)
@Generable
private struct AppleIntelligenceTurn {
  @Guide(
    description: "The next step. Use tool when app data must be read or changed; otherwise use final.",
    .anyOf(["tool", "final"])
  )
  var type: String

  @Guide(
    description: "For a tool step, the exact available tool name. For a final step, an empty string.",
    .anyOf([
      "", "addFridgeItem", "addShoppingItem", "removeFridgeItem",
      "removeShoppingItem", "findInFridge", "findInShoppingList",
      "getFridgeContents", "getShoppingListContents", "streamlineLists",
      "proposeAddAllToFridge",
    ])
  )
  var name: String

  @Guide(description: "For a tool step, a valid JSON object containing the tool arguments. For a final step, use {}.")
  var arguments: String

  @Guide(description: "For a final step, the conversational answer to the user. For a tool step, an empty string.")
  var text: String
}
#endif

public final class AppleIntelligenceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleIntelligence")

    AsyncFunction("getAvailability") { () -> [String: Any] in
      return Self.availability()
    }

    AsyncFunction("openSettings") { () async -> Bool in
      guard let url = URL(string: UIApplication.openSettingsURLString) else {
        return false
      }
      return await UIApplication.shared.open(url)
    }

    AsyncFunction("generate") { (instructions: String, prompt: String) async throws -> String in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        guard SystemLanguageModel.default.isAvailable else {
          throw AppleIntelligenceException("Apple Intelligence is not available right now.")
        }
        let session = LanguageModelSession(instructions: instructions)
        let response = try await session.respond(to: prompt)
        return response.content
      }
      #endif
      throw AppleIntelligenceException("Apple Intelligence requires iOS 26 or later.")
    }

    AsyncFunction("generateToolTurn") { (instructions: String, prompt: String) async throws -> [String: String] in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        guard SystemLanguageModel.default.isAvailable else {
          throw AppleIntelligenceException("Apple Intelligence is not available right now.")
        }
        let session = LanguageModelSession(instructions: instructions)
        let response = try await session.respond(
          to: prompt,
          generating: AppleIntelligenceTurn.self
        )
        return [
          "type": response.content.type,
          "name": response.content.name,
          "arguments": response.content.arguments,
          "text": response.content.text,
        ]
      }
      #endif
      throw AppleIntelligenceException("Apple Intelligence requires iOS 26 or later.")
    }
  }

  private static func availability() -> [String: Any] {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      switch SystemLanguageModel.default.availability {
      case .available:
        return result("available", true, "Apple Intelligence is ready on this device.")
      case .unavailable(.deviceNotEligible):
        return result("device_not_eligible", false, "This device does not support Apple Intelligence.")
      case .unavailable(.appleIntelligenceNotEnabled):
        return result("not_enabled", false, "Apple Intelligence is supported but turned off in Settings.")
      case .unavailable(.modelNotReady):
        return result("model_not_ready", false, "The Apple Intelligence model is still downloading or is temporarily not ready.")
      case .unavailable:
        return result("unavailable", false, "Apple Intelligence is unavailable for a system reason that iOS did not identify.")
      }
    }
    #endif
    return result("unsupported_os", false, "Apple Intelligence in apps requires iOS 26 or later.")
  }

  private static func result(_ status: String, _ available: Bool, _ reason: String) -> [String: Any] {
    ["status": status, "available": available, "reason": reason]
  }
}

private struct AppleIntelligenceException: LocalizedError {
  let message: String

  init(_ message: String) {
    self.message = message
  }

  var errorDescription: String? { message }
}
