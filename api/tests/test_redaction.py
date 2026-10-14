from app.redaction import RehydrationStats, StreamRehydrator, Vault, detect, redact, rehydrate

TFN = "123 456 782"  # documented test TFN, passes the mod-11 check


def types(text):
    return [d.pii_type for d in detect(text)]


def test_checksums_gate_detection():
    assert types(f"TFN {TFN}") == ["AU_TFN"]
    assert types("TFN 123 456 789") == []  # fails mod-11
    assert types("card 4111 1111 1111 1111") == ["CREDIT_CARD"]
    assert types("card 4111 1111 1111 1112") == []  # fails Luhn
    assert types("ABN 51 824 753 556") == ["AU_ABN"]
    assert types("Medicare 2123 45670 1") == ["AU_MEDICARE"]


def test_other_identifiers():
    assert types("mail jane.smith@customerbank.com.au now") == ["EMAIL"]
    assert types("call 0412 345 678") == ["AU_PHONE"]
    assert types("met Dr Sarah Ahmed today") == ["PERSON_NAME"]


def test_ordinal_tokens_are_stable_per_value():
    v = Vault()
    text, _ = redact(f"{TFN} then 123-456-782 and a@x.com, b@y.com", v)
    assert text == "⟦AU_TFN_1⟧ then ⟦AU_TFN_1⟧ and ⟦EMAIL_1⟧, ⟦EMAIL_2⟧"
    assert v.signature == "AU_TFN_1,EMAIL_1,EMAIL_2"


def test_skip_types_pass_through():
    v = Vault()
    text, _ = redact("write to a@x.com", v, frozenset({"EMAIL"}))
    assert text == "write to a@x.com" and len(v) == 0


def test_rehydrate_restores_and_masks_by_policy():
    v = Vault()
    redact(f"{TFN} card 4111 1111 1111 1111", v)
    stats = RehydrationStats()
    out = rehydrate("TFN ⟦AU_TFN_1⟧, card ⟦CREDIT_CARD_1⟧, [[AU_TFN_1]], ⟦EMAIL_9⟧", v, {"CREDIT_CARD": False}, stats)
    assert out == f"TFN {TFN}, card [card •••• 1111], {TFN}, ⟦EMAIL_9⟧"
    assert (stats.rehydrated, stats.masked, stats.misses) == (2, 1, 1)


def test_stream_rehydration_handles_every_split_point():
    v = Vault()
    redact(f"{TFN} jane@bank.com.au", v)
    raw = "Dear ⟦EMAIL_1⟧, your TFN ⟦AU_TFN_1⟧ is on file [ok]. [[EMAIL_1]] done ["
    expected = rehydrate(raw, v, {}, RehydrationStats())
    for i in range(1, len(raw)):
        for j in range(i, len(raw)):
            r = StreamRehydrator(v, {})
            got = r.feed(raw[:i]) + r.feed(raw[i:j]) + r.feed(raw[j:]) + r.flush()
            assert got == expected, (i, j)
