"""P7: production stack configuration safety.

Static text checks on compose.prod.yml, nginx/prod.conf and the CI publish
path (no YAML dependency, no Docker, no database). CI also runs
`docker compose -f compose.prod.yml config` and `nginx -t` on these files.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

_PROD_SERVICES = ("db", "migrate", "api", "frontend", "nginx")


def _read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def _block(text: str, header: str, siblings: tuple[str, ...], indent: str) -> str:
    """Lines under `<indent><header>:` up to the next sibling at the same indent."""
    marker = f"\n{indent}{header}:\n"
    assert marker in text, f"{header!r} not found"
    out = []
    for line in text.split(marker, 1)[1].splitlines():
        if any(line == f"{indent}{s}:" for s in siblings):
            break
        if line and not line.startswith(indent + " ") and not line.startswith(indent + "#"):
            break
        out.append(line)
    return "\n".join(out)


def _code(text: str) -> str:
    """The text without comment-only lines (comments may name what is forbidden)."""
    return "\n".join(ln for ln in text.splitlines() if not ln.lstrip().startswith("#"))


def _service(name: str) -> str:
    return _block(_read("compose.prod.yml"), name, _PROD_SERVICES, "  ")


def _values(text: str, key: str) -> set[str]:
    return set(re.findall(rf"^\s*{key}:\s*(\S+)\s*$", text, flags=re.M))


# --------------------------------------------------------------------------- #
# compose.prod.yml
# --------------------------------------------------------------------------- #

def test_prod_stack_is_isolated_from_the_dev_and_demo_stacks():
    prod, dev, demo = _read("compose.prod.yml"), _read("compose.yml"), _read("compose.demo.yml")
    assert re.search(r"^name: inventory-prod$", prod, flags=re.M)

    prod_containers = _values(prod, "container_name")
    assert prod_containers and all(c.startswith("inventory-prod-") for c in prod_containers)
    assert prod_containers.isdisjoint(_values(dev, "container_name") | _values(demo, "container_name"))

    volumes = _block(prod, "volumes", ("services", "networks"), "")
    keys = re.findall(r"^  (\w+):$", volumes, flags=re.M)
    names = re.findall(r"^    name: (\S+)$", volumes, flags=re.M)
    assert keys and len(names) == len(keys), "every prod volume needs an explicit name"
    assert all(n.startswith("inventory-prod-") for n in names)
    assert set(names).isdisjoint(_values(dev, "name") | _values(demo, "name"))


def test_prod_compose_has_the_full_browser_path():
    for name in _PROD_SERVICES:
        assert _service(name)
    frontend = _service("frontend")
    assert "API_BASE_URL: http://api:8081" in frontend
    assert 'COOKIE_SECURE: "1"' in frontend
    assert "./nginx/prod.conf:/etc/nginx/conf.d/default.conf:ro" in _service("nginx")


def test_prod_compose_only_nginx_publishes_a_port_and_only_on_loopback():
    for name in _PROD_SERVICES:
        block = _service(name)
        if name == "nginx":
            assert re.findall(r"^\s+- \"(.+)\"$", block.split("ports:", 1)[1], flags=re.M)[0] == "127.0.0.1:8090:80"
        else:
            assert not re.search(r"^\s+ports:", block, flags=re.M), name


def test_prod_compose_images_are_pinned_by_required_variables():
    for name in ("api", "migrate"):
        assert "image: ${API_IMAGE:?" in _service(name), name
    assert "image: ${FRONTEND_IMAGE:?" in _service("frontend")
    assert ":latest" not in _code(_read("compose.prod.yml"))


def test_prod_compose_migrations_are_one_shot_only():
    assert 'profiles: ["migrate"]' in _service("migrate")
    assert "command:" not in _service("api")


# --------------------------------------------------------------------------- #
# nginx/prod.conf
# --------------------------------------------------------------------------- #

def test_prod_nginx_proxies_only_the_frontend():
    conf = _code(_read("nginx/prod.conf"))
    assert "set $frontend_upstream http://frontend:3000;" in conf
    assert "proxy_pass $frontend_upstream;" in conf
    assert "api:8081" not in conf
    assert "location /api/v1" not in conf


def test_prod_nginx_matches_the_reviewed_demo_rules():
    # Same real-IP trust, headers and upload ceiling as nginx/demo.conf; only
    # the comments and the upstream name differ.
    def rules(text: str) -> list[str]:
        return [
            ln.strip().replace("demo_frontend", "X").replace("prod_frontend", "X")
            for ln in text.splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]

    assert rules(_read("nginx/prod.conf")) == rules(_read("nginx/demo.conf"))


def test_nginx_re_resolves_the_frontend_after_a_container_is_recreated():
    # Prod incident 2026-11-26: a static `upstream { server frontend:3000; }`
    # is resolved once at nginx start, so recreating the frontend container
    # (new IP) left nginx proxying to a dead address (502 on every page).
    # Both configs must resolve through Docker DNS at request time instead.
    for path in ("nginx/prod.conf", "nginx/demo.conf"):
        conf = _code(_read(path))
        assert "resolver 127.0.0.11 valid=10s" in conf, path
        assert not any(ln.strip().startswith("upstream ") for ln in conf.splitlines()), path  # no static upstream block
        assert "proxy_pass $frontend_upstream;" in conf, path
        assert "proxy_pass http://" not in conf, path   # every proxy_pass goes through the variable


# --------------------------------------------------------------------------- #
# CI publish path
# --------------------------------------------------------------------------- #

_TESTS_JOBS = ("test", "publish")


def test_required_job_names_are_unchanged():
    # The repository ruleset requires these exact check names.
    assert "    name: Pytest on Python 3.12\n" in _read(".github/workflows/tests.yml")
    assert "    name: Frontend checks\n" in _read(".github/workflows/frontend.yml")


def test_workflow_is_least_privilege_and_publishes_only_on_tags():
    wf = _read(".github/workflows/tests.yml")
    assert "refactor/production-v2" not in wf
    assert re.search(r"^permissions:\n  contents: read\n\n", wf, flags=re.M)
    assert wf.count("packages: write") == 1

    jobs = wf.split("\njobs:\n", 1)[1]
    test = _block("\n" + jobs, "test", _TESTS_JOBS, "  ")
    publish = _block("\n" + jobs, "publish", _TESTS_JOBS, "  ")
    assert "docker/login-action" not in test
    assert "needs: test" in publish
    assert "startsWith(github.ref, 'refs/tags/v')" in publish
    assert "packages: write" in publish
    assert re.findall(r"context: (\S+)", publish) == [".", "frontend"]
    assert ":latest" not in _code(wf)


def test_every_action_is_pinned_to_a_full_commit_sha():
    for name in ("tests.yml", "frontend.yml"):
        wf = _read(f".github/workflows/{name}")
        uses = re.findall(r"uses: (\S+)", wf)
        assert uses
        for u in uses:
            assert re.fullmatch(r"[\w.-]+/[\w.-]+@[0-9a-f]{40}", u), f"{name}: {u}"
        checkouts = wf.count("uses: actions/checkout@")
        assert wf.count("persist-credentials: false") == checkouts, name
