from app.difftext import compute_draft_edit_distance

# Expected edit distances captured from jsdiff diffWords (Task 4 Step 1).
# Raw node output:
# {"a":"Repair spall in pavement.","b":"Repair the spall.","ed":16,...}
# {"a":"FOD on runway","b":"FOD on runway","ed":0,...}
# {"a":"","b":"New text here","ed":13,...}
# {"a":"Crack near centerline marking","b":"Crack near the centerline marking; reseal","ed":12,...}
GROUND_TRUTH = [
    ("Repair spall in pavement.", "Repair the spall.", 16),
    ("FOD on runway", "FOD on runway", 0),
    ("", "New text here", 13),
    ("Crack near centerline marking", "Crack near the centerline marking; reseal", 12),
]


def test_edit_distance_matches_jsdiff():
    for ai, final, expected in GROUND_TRUTH:
        assert expected is not None, "fill expected from jsdiff ground truth (Step 1)"
        assert compute_draft_edit_distance(ai, final) == expected, (ai, final)


def test_identical_text_is_zero():
    assert compute_draft_edit_distance("same words", "same words") == 0
