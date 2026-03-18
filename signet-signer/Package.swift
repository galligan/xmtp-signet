// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "signet-signer",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "signet-signer", targets: ["signet-signer"]),
        .library(name: "SignetCore", targets: ["SignetCore"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.3.0"),
    ],
    targets: [
        .executableTarget(
            name: "signet-signer",
            dependencies: [
                "SignetCore",
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
            ]
        ),
        .target(
            name: "SignetCore",
            dependencies: []
        ),
        .testTarget(
            name: "SignetCoreTests",
            dependencies: ["SignetCore"]
        ),
    ]
)
