import XCTest
@testable import SignetCore

final class SignatureFormatterTests: XCTestCase {

    // MARK: - Hex Parsing

    func testParseHexValid() throws {
        let data = try SignatureFormatter.parseHex("deadbeef")
        XCTAssertEqual(data, Data([0xde, 0xad, 0xbe, 0xef]))
    }

    func testParseHexWithPrefix() throws {
        let data = try SignatureFormatter.parseHex("0xCAFE")
        XCTAssertEqual(data, Data([0xca, 0xfe]))
    }

    func testParseHexEmptyThrows() {
        XCTAssertThrowsError(try SignatureFormatter.parseHex(""))
    }

    func testParseHexOddLengthThrows() {
        XCTAssertThrowsError(try SignatureFormatter.parseHex("abc"))
    }

    func testParseHexInvalidCharsThrows() {
        XCTAssertThrowsError(try SignatureFormatter.parseHex("zzzz"))
    }

    // MARK: - Hex Formatting

    func testFormatHex() {
        let data = Data([0xde, 0xad, 0xbe, 0xef])
        XCTAssertEqual(SignatureFormatter.formatHex(data), "deadbeef")
    }

    // MARK: - DER Parsing

    func testParseDERSignature() throws {
        // A minimal valid DER ECDSA signature
        // SEQUENCE { INTEGER(r=0x01), INTEGER(s=0x02) }
        let der = Data([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02])
        let (r, s) = try SignatureFormatter.parseDERSignature(der)
        XCTAssertEqual(r, Data([0x01]))
        XCTAssertEqual(s, Data([0x02]))
    }

    func testParseDERStripsLeadingZeros() throws {
        // r has leading 0x00 (positive sign byte), s has leading 0x00
        let der = Data([0x30, 0x08, 0x02, 0x02, 0x00, 0x80, 0x02, 0x02, 0x00, 0xFF])
        let (r, s) = try SignatureFormatter.parseDERSignature(der)
        XCTAssertEqual(r, Data([0x80]))
        XCTAssertEqual(s, Data([0xFF]))
    }

    func testParseDERTooShortThrows() {
        let der = Data([0x30, 0x01])
        XCTAssertThrowsError(try SignatureFormatter.parseDERSignature(der))
    }

    // MARK: - Low-S Normalization

    func testLowSAlreadyLow() {
        // s = 1 (well below half order)
        let s = Data([0x01])
        let result = SignatureFormatter.applyLowS(s: s)
        XCTAssertEqual(result, s)
    }

    func testLowSNormalizesHighS() {
        // s = curveOrder - 1 (which is > halfOrder, so should be normalized to 2)
        let highS = SignatureFormatter.subtractBigEndian(
            SignatureFormatter.curveOrder,
            Data([0x01])
        )
        let result = SignatureFormatter.applyLowS(s: highS)
        // curveOrder - highS = curveOrder - (curveOrder - 1) = 1
        XCTAssertEqual(result, Data([0x01]))
    }

    func testLowSHalfOrderIsLow() {
        // s = halfOrder exactly — should remain unchanged (not greater than)
        let result = SignatureFormatter.applyLowS(s: SignatureFormatter.halfOrder)
        XCTAssertEqual(result, SignatureFormatter.halfOrder)
    }

    // MARK: - DER Round-Trip

    func testDERRoundTrip() throws {
        let r = Data([0x80, 0x01, 0x02])
        let s = Data([0x7F, 0x03, 0x04])
        let der = SignatureFormatter.reconstructDER(r: r, s: s)
        let (parsedR, parsedS) = try SignatureFormatter.parseDERSignature(der)
        XCTAssertEqual(parsedR, r)
        XCTAssertEqual(parsedS, s)
    }

    func testDERReconstructionAddsSignByte() throws {
        // r with high bit set needs 0x00 prefix in DER
        let r = Data([0xFF])
        let s = Data([0x01])
        let der = SignatureFormatter.reconstructDER(r: r, s: s)
        // Should be: 30 06 02 02 00 FF 02 01 01
        XCTAssertEqual(der[0], 0x30) // SEQUENCE
        XCTAssertEqual(der[2], 0x02) // INTEGER tag
        XCTAssertEqual(der[3], 0x02) // length 2 (0x00 + 0xFF)
        XCTAssertEqual(der[4], 0x00) // sign byte
        XCTAssertEqual(der[5], 0xFF) // value
    }

    // MARK: - Big-Endian Arithmetic

    func testCompareBigEndianEqual() {
        let a = Data([0x01, 0x02])
        XCTAssertEqual(SignatureFormatter.compareBigEndian(a, a), 0)
    }

    func testCompareBigEndianLessThan() {
        let a = Data([0x01])
        let b = Data([0x02])
        XCTAssertEqual(SignatureFormatter.compareBigEndian(a, b), -1)
    }

    func testCompareBigEndianGreaterThan() {
        let a = Data([0xFF])
        let b = Data([0x01])
        XCTAssertEqual(SignatureFormatter.compareBigEndian(a, b), 1)
    }

    func testSubtractBigEndian() {
        let a = Data([0x10])
        let b = Data([0x01])
        let result = SignatureFormatter.subtractBigEndian(a, b)
        XCTAssertEqual(result, Data([0x0F]))
    }

    func testLeftPad() {
        let data = Data([0x01])
        let padded = SignatureFormatter.leftPad(data, to: 4)
        XCTAssertEqual(padded, Data([0x00, 0x00, 0x00, 0x01]))
    }
}
