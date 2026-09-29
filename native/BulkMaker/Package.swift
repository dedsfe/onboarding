// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "BulkMaker",
    platforms: [.macOS(.v26)],
    products: [.executable(name: "BulkMaker", targets: ["BulkMaker"])],
    dependencies: [
        .package(url: "https://github.com/migueldeicaza/SwiftTerm", exact: "1.11.2")
    ],
    targets: [
        .executableTarget(name: "BulkMaker", dependencies: ["SwiftTerm"], resources: [.process("Resources")]),
        .testTarget(name: "BulkMakerTests", dependencies: ["BulkMaker"])
    ],
    swiftLanguageModes: [.v5]
)
