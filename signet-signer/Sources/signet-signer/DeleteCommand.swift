import ArgumentParser
import Foundation
import SignetCore

struct DeleteCommand: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "delete",
        abstract: "Delete a Secure Enclave key (best-effort)"
    )

    @OptionGroup var globals: GlobalOptions

    @Option(name: .long, help: "Base64-encoded SE key reference to delete")
    var keyRef: String

    mutating func run() throws {
        let manager = SecureEnclaveManager()
        manager.deleteKey(keyRef)
        // Exit 0 — deletion is best-effort
    }
}
