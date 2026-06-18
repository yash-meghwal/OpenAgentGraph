// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SwiftUIAppLite",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "SwiftUIAppLite", targets: ["SwiftUIAppLite"]),
    ],
    targets: [
        .target(name: "SwiftUIAppLite"),
    ]
)