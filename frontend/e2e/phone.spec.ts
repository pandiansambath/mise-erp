import { test, expect } from "@playwright/test";

import { joinPhone, splitPhone } from "../components/PhoneInput";

/** The risk in this component is not the picker, it is the PARSER.
 *
 *  Phone numbers already exist in this database, typed by hand over months,
 *  in every shape a person invents. If `splitPhone` guesses wrong, a supplier's
 *  Indian mobile silently becomes a UK one and the restaurant rings the wrong
 *  number — a failure that looks like bad data rather than a bug.
 *
 *  So: what it must do with what is already there, pinned.
 */

test.describe("splitPhone — existing data must survive", () => {
  test("keeps a bare national number and does not invent a country", () => {
    // Written before this component existed. It shows the default country and
    // the digits are untouched — nothing is reassigned to a country the user
    // never chose.
    expect(splitPhone("07700900123", "GB")).toEqual({ country: "GB", number: "07700900123" });
    expect(splitPhone("9876543210", "IN")).toEqual({ country: "IN", number: "9876543210" });
  });

  test("reads a dial code the user did type", () => {
    expect(splitPhone("+91 9876543210")).toEqual({ country: "IN", number: "9876543210" });
    expect(splitPhone("+44 7700 900123")).toEqual({ country: "GB", number: "7700900123" });
    expect(splitPhone("+971-50-1234567")).toEqual({ country: "AE", number: "501234567" });
  });

  test("understands 00 as the other way to write +", () => {
    expect(splitPhone("0091 9876543210")).toEqual({ country: "IN", number: "9876543210" });
    expect(splitPhone("00 44 7700900123")).toEqual({ country: "GB", number: "7700900123" });
  });

  test("longest dial code wins", () => {
    // +971 must not be read as +9, and +91 must not be read as +9.
    expect(splitPhone("+9715012345").country).toBe("AE");
    expect(splitPhone("+919876543").country).toBe("IN");
    // +353 must not be read as +35 or +3.
    expect(splitPhone("+353871234567").country).toBe("IE");
  });

  test("an unrecognised country keeps the whole number rather than losing it", () => {
    const r = splitPhone("+998901234567", "GB");
    expect(r.number).toBe("+998901234567");
    expect(r.country).toBe("GB");
  });

  test("empty stays empty", () => {
    expect(splitPhone("", "GB")).toEqual({ country: "GB", number: "" });
    expect(splitPhone("   ", "IN")).toEqual({ country: "IN", number: "" });
  });
});

test.describe("joinPhone", () => {
  test("writes one canonical shape", () => {
    expect(joinPhone("IN", "9876543210")).toBe("+91 9876543210");
    expect(joinPhone("GB", "7700 900 123")).toBe("+44 7700900123");
  });

  test("an empty number is empty, NOT a bare dial code", () => {
    // "+44" alone in a database column looks like a phone number and is not
    // one. Anything that renders it as a tel: link would produce a dead call.
    expect(joinPhone("GB", "")).toBe("");
    expect(joinPhone("GB", "   ")).toBe("");
  });

  test("round-trips", () => {
    for (const v of ["+91 9876543210", "+44 7700900123", "+353 871234567"]) {
      const { country, number } = splitPhone(v);
      expect(joinPhone(country, number)).toBe(v);
    }
  });
});
