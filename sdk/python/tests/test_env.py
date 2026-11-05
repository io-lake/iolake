"""Environment and file-based configuration.

Mirrored by sdk/go/iolake/env_test.go.
"""

import pytest

from iolake import Client
from iolake.client import provisioner_user_id_from_env

ALL_VARS = [
    "IOLAKE_ENDPOINT",
    "IOLAKE_URL",
    "IOLAKE_ACCESS_KEY",
    "IOLAKE_ACCESS_KEY_FILE",
    "IOLAKE_SECRET_KEY",
    "IOLAKE_SECRET_KEY_FILE",
    "IOLAKE_REGION",
    "IOLAKE_PROVISIONER_USER_ID",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
]


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ALL_VARS:
        monkeypatch.delenv(name, raising=False)


def test_reads_the_iolake_names(monkeypatch):
    monkeypatch.setenv("IOLAKE_ENDPOINT", "https://s3.example.com")
    monkeypatch.setenv("IOLAKE_ACCESS_KEY", "AKIA1")
    monkeypatch.setenv("IOLAKE_SECRET_KEY", "s3cret")
    monkeypatch.setenv("IOLAKE_REGION", "eu-west-1")

    c = Client.from_env()
    assert (c.endpoint, c.access_key, c.secret_key, c.region) == (
        "https://s3.example.com",
        "AKIA1",
        "s3cret",
        "eu-west-1",
    )


def test_iolake_url_is_a_synonym_for_endpoint(monkeypatch):
    monkeypatch.setenv("IOLAKE_URL", "https://s3.example.com")
    monkeypatch.setenv("IOLAKE_ACCESS_KEY", "AKIA1")
    monkeypatch.setenv("IOLAKE_SECRET_KEY", "s3cret")
    assert Client.from_env().endpoint == "https://s3.example.com"


def test_falls_back_to_the_aws_names(monkeypatch):
    # A pod that already carries AWS credentials for its S3 client should not
    # need a second copy under different names.
    monkeypatch.setenv("IOLAKE_ENDPOINT", "https://s3.example.com")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAAWS")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "awssecret")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "ap-south-1")

    c = Client.from_env()
    assert (c.access_key, c.secret_key, c.region) == ("AKIAAWS", "awssecret", "ap-south-1")


def test_iolake_names_win_over_aws(monkeypatch):
    monkeypatch.setenv("IOLAKE_ENDPOINT", "https://s3.example.com")
    monkeypatch.setenv("IOLAKE_ACCESS_KEY", "AKIAOWN")
    monkeypatch.setenv("IOLAKE_SECRET_KEY", "own")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAAWS")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "awssecret")

    c = Client.from_env()
    assert (c.access_key, c.secret_key) == ("AKIAOWN", "own")


def test_secret_from_a_file_and_the_trailing_newline_is_stripped(monkeypatch, tmp_path):
    # This is the bug the strip() exists for: a projected Kubernetes Secret
    # ends in a newline, and a "\n" inside the signing key produces a
    # SignatureDoesNotMatch that reads like a wrong password.
    secret = tmp_path / "secret"
    secret.write_text("s3cret\n")
    access = tmp_path / "access"
    access.write_text("AKIAFILE\n")

    monkeypatch.setenv("IOLAKE_ENDPOINT", "https://s3.example.com")
    monkeypatch.setenv("IOLAKE_ACCESS_KEY_FILE", str(access))
    monkeypatch.setenv("IOLAKE_SECRET_KEY_FILE", str(secret))

    c = Client.from_env()
    assert (c.access_key, c.secret_key) == ("AKIAFILE", "s3cret")


def test_the_file_wins_over_the_inline_value(monkeypatch, tmp_path):
    secret = tmp_path / "secret"
    secret.write_text("from-file")
    monkeypatch.setenv("IOLAKE_ENDPOINT", "https://s3.example.com")
    monkeypatch.setenv("IOLAKE_ACCESS_KEY", "AKIA1")
    monkeypatch.setenv("IOLAKE_SECRET_KEY", "from-env")
    monkeypatch.setenv("IOLAKE_SECRET_KEY_FILE", str(secret))
    assert Client.from_env().secret_key == "from-file"


def test_region_defaults(monkeypatch):
    monkeypatch.setenv("IOLAKE_ENDPOINT", "https://s3.example.com")
    monkeypatch.setenv("IOLAKE_ACCESS_KEY", "AKIA1")
    monkeypatch.setenv("IOLAKE_SECRET_KEY", "s")
    assert Client.from_env().region == "us-east-1"


@pytest.mark.parametrize(
    "present,missing",
    [
        ({"IOLAKE_ACCESS_KEY": "a", "IOLAKE_SECRET_KEY": "b"}, "IOLAKE_ENDPOINT"),
        ({"IOLAKE_ENDPOINT": "https://x", "IOLAKE_SECRET_KEY": "b"}, "IOLAKE_ACCESS_KEY"),
        ({"IOLAKE_ENDPOINT": "https://x", "IOLAKE_ACCESS_KEY": "a"}, "IOLAKE_SECRET_KEY"),
    ],
)
def test_missing_settings_name_themselves(monkeypatch, present, missing):
    for k, v in present.items():
        monkeypatch.setenv(k, v)
    with pytest.raises(ValueError, match=missing):
        Client.from_env()


def test_unreadable_secret_file_is_an_error(monkeypatch, tmp_path):
    monkeypatch.setenv("IOLAKE_ENDPOINT", "https://s3.example.com")
    monkeypatch.setenv("IOLAKE_ACCESS_KEY", "AKIA1")
    monkeypatch.setenv("IOLAKE_SECRET_KEY_FILE", str(tmp_path / "nope"))
    with pytest.raises(OSError):
        Client.from_env()


def test_provisioner_user_id(monkeypatch):
    assert provisioner_user_id_from_env() == ""
    monkeypatch.setenv("IOLAKE_PROVISIONER_USER_ID", " abc-123 \n")
    assert provisioner_user_id_from_env() == "abc-123"
