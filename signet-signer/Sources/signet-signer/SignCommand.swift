import ArgumentParser
import Foundation
import SignetCore

struct SignCommand: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "sign",
        abstract: "Sign data with a Secure Enclave key"
    )

    @OptionGroup var globals: GlobalOptions

    @Option(name: .long, help: "Base64-encoded SE key reference")
    var keyRef: String

    @Option(name: .long, help: "Hex-encoded data to sign")
    var data: String

    mutating func run() throws {
        // Parse key reference
        guard let dataRep = Data(base64Encoded: keyRef) else {
            writeStderr("invalid key reference: not valid base64")
            throw ExitCode(1)
        }

        // Parse hex data
        let inputBytes: Data
        do {
            inputBytes = try SignatureFormatter.parseHex(data)
        } catch {
            writeStderr("invalid hex data: \(error)")
            throw ExitCode(1)
        }

        // Sign
        let manager = SecureEnclaveManager()
        let derSignature: Data
        do {
            derSignature = try manager.signData(inputBytes, dataRepresentation: dataRep)
        } catch let error as SignetError {
            if case .authCancelled = error {
                writeStderr(error.description)
                throw ExitCode(2)
            }
            writeStderr(error.description)
            throw ExitCode(1)
        }

        // Parse DER and apply low-S normalization
        let (r, rawS) = try SignatureFormatter.parseDERSignature(derSignature)
        let s = SignatureFormatter.applyLowS(s: rawS)
        let normalizedDER = SignatureFormatter.reconstructDER(r: r, s: s)

        let output = SignResponse(
            signature: SignatureFormatter.formatHex(normalizedDER)
        )

        try outputJSON(output)
    }
}
