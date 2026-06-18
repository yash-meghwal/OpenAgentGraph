import XCTest
@testable import MyLib

final class ServiceTests: XCTestCase {
    func testGreet() {
        XCTAssertEqual(Service().greet(), "hello")
    }
}