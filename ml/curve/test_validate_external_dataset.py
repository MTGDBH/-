# -*- coding: utf-8 -*-
from pathlib import Path

from validate_external_dataset import validate


ROOT = Path(__file__).resolve().parent
result = validate(ROOT / "external_dataset_template.csv")
assert result["valid"] is False
assert "dataset is empty" in result["errors"]
assert result["n_rows"] == 0
print("external dataset validator template gate: PASS", result["errors"])
