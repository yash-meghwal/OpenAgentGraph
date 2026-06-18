import Foundation

public protocol Greeter {
    func greet() -> String
}

public struct Service: Greeter {
    public func greet() -> String {
        "hello"
    }
}