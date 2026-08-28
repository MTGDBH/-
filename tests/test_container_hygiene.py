import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_git_and_docker_context_exclude_private_artifacts():
    tracked = subprocess.check_output(['git', 'ls-files'], cwd=ROOT, text=True).splitlines()
    forbidden = []
    for name in tracked:
        normalized = name.replace('\\', '/').lower()
        if '/__pycache__/' in f'/{normalized}' or normalized.endswith(('.pyc', '.pyo')):
            forbidden.append(name)
        if normalized.endswith(('.db', '.sqlite', '.sqlite3')) or ('/.env' in f'/{normalized}' and not normalized.endswith('.env.example')):
            forbidden.append(name)
    assert not forbidden, f'private/cache files tracked: {forbidden}'

    dockerignore = (ROOT / '.dockerignore').read_text(encoding='utf-8')
    for required in ('**/.env', '**/*.db', '**/__pycache__', 'private-artifacts'):
        assert required in dockerignore
