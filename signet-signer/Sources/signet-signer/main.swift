import ArgumentParser
import Foundation
import SignetCore

extension KeyPolicy: ExpressibleByArgument {}

struct SignetSigner: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "signet-signer",
        abstract: "P-256 key operations via Apple Secure Enclave",
        version: "0.1.0",
        subcommands: [
            CreateCommand.self,
            SignCommand.self,
            InfoCommand.self,
            DeleteCommand.self,
        ]
    )
}

// MARK: - Global Options

struct GlobalOptions: ParsableArguments {
    @Option(name: .long, help: "Output format: json")
    var format: String = "json"
}

// MARK: - Output Helpers

func makeEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return encoder
}

func writeStdout(_ string: String) {
    if let data = string.data(using: .utf8) {
        FileHandle.standardOutput.write(data)
    }
}

func writeStderr(_ string: String) {
    if let data = "error: \(string)\n".data(using: .utf8) {
        FileHandle.standardError.write(data)
    }
}

func outputJSON<T: Encodable>(_ value: T) throws {
    let encoder = makeEncoder()
    let data = try encoder.encode(value)
    FileHandle.standardOutput.write(data)
    writeStdout("\n")
}

SignetSigner.main()
