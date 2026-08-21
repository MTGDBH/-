from pathlib import Path

from analyze_human_evaluation import analyze


result = analyze(Path(__file__).with_name("human-evaluation-data-template.csv"))
assert result["status"] == "incomplete"
assert result["n_rows"] == 0
assert result["older_adult_participants"] == 0
print("human evaluation analyzer template gate: PASS")
