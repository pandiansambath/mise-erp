#!/usr/bin/env python3
"""Prune old container images out of ECR, and stop them coming back.

WHY THIS EXISTS
---------------
On 2026-09-10 the two ECR repositories held **896 images totalling 104 GB**,
built up over seven weeks because every deploy pushes two ~115 MB images and
nothing ever deleted the old ones. At $0.10/GB-month that was **$10.17/month
and growing about $2.50 every month** — roughly a quarter of the entire AWS
bill, and the only line item that grew on its own.

His rule: **never keep more than 3 images per repository.** Three is the
current build plus two rollbacks; anything older than two deploys is a rebuild
from git, not a rollback.

TWO HALVES, AND BOTH MATTER
---------------------------
1. This script deletes the backlog that has already accumulated.
2. It then installs a **lifecycle policy**, which is what actually keeps the
   problem solved. A one-off cleanup without the policy just grows straight
   back at $2.50/month.

THE --keep FLOOR
----------------
The bulk delete defaults to keeping 5, not 3, while the lifecycle policy is
set to 3. That is deliberate: a deploy may be in flight, and its freshly
pushed image must not be deleted out from under the pull. AWS then trims the
extra two within a day, so the steady state is exactly the 3 he asked for.

Deleting an image here cannot take the site down: the running containers
already have their layers on the EC2 box, and ECR is only read at deploy time.

Usage:
    python scripts/ecr_prune.py --dry-run     # show what would go
    python scripts/ecr_prune.py               # delete, then install the policy
    python scripts/ecr_prune.py --keep 3      # trim right down (no deploy running)
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

REGION = "eu-west-2"
REPOS = ["mise-frontend", "mise-backend"]
#: What the lifecycle policy enforces from here on, regardless of --keep.
POLICY_KEEP = 3


def aws(*args: str) -> dict:
    """Run an aws CLI command and parse its JSON. Raises on a non-zero exit."""
    out = subprocess.run(
        ["aws", *args, "--region", REGION, "--output", "json"],
        capture_output=True,
        text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"aws {' '.join(args[:3])} failed:\n{out.stderr.strip()}")
    return json.loads(out.stdout) if out.stdout.strip() else {}


def all_images(repo: str) -> list[dict]:
    """Every image in the repository, oldest first.

    Paginated by hand: `describe-images` returns 100 at a time and the CLI's
    own pagination was silently capping this at 100 when first measured, which
    made the repo look 4x smaller than it was.
    """
    images: list[dict] = []
    token: str | None = None
    while True:
        args = ["ecr", "describe-images", "--repository-name", repo, "--max-items", "100"]
        if token:
            args += ["--starting-token", token]
        page = aws(*args)
        images.extend(page.get("imageDetails", []))
        token = page.get("NextToken")
        if not token:
            break
    images.sort(key=lambda i: i["imagePushedAt"])
    return images


def prune(repo: str, keep: int, dry_run: bool) -> tuple[int, float]:
    images = all_images(repo)
    total_gb = sum(i.get("imageSizeInBytes", 0) for i in images) / 1e9
    doomed = images[:-keep] if keep else images
    freed_gb = sum(i.get("imageSizeInBytes", 0) for i in doomed) / 1e9

    print(f"\n{repo}")
    print(f"  {len(images)} images, {total_gb:.1f} GB")
    if not doomed:
        print(f"  nothing to delete (already <= {keep})")
        return 0, 0.0
    print(f"  keeping the newest {keep}, deleting {len(doomed)} ({freed_gb:.1f} GB)")
    for i in images[-keep:]:
        tags = ",".join(i.get("imageTags", [])) or "<untagged>"
        print(f"    keep  {i['imagePushedAt'][:19]}  {tags[:40]}")

    if dry_run:
        print("  DRY RUN — nothing deleted")
        return 0, 0.0

    # batch-delete-image takes at most 100 ids per call.
    deleted = 0
    for n in range(0, len(doomed), 100):
        chunk = doomed[n : n + 100]
        ids = json.dumps([{"imageDigest": i["imageDigest"]} for i in chunk])
        res = aws(
            "ecr", "batch-delete-image",
            "--repository-name", repo,
            "--image-ids", ids,
        )
        deleted += len(res.get("imageIds", []))
        for f in res.get("failures", []):
            print(f"    FAILED {f.get('imageId')}: {f.get('failureReason')}")
        print(f"    deleted {deleted}/{len(doomed)}")
    return deleted, freed_gb


def install_policy(repo: str, dry_run: bool) -> None:
    """The part that actually keeps it fixed."""
    policy = {
        "rules": [
            {
                "rulePriority": 1,
                "description": (
                    f"Keep only the {POLICY_KEEP} most recent images. "
                    "896 images / 104 GB / $10 a month accumulated in seven "
                    "weeks without this."
                ),
                "selection": {
                    "tagStatus": "any",
                    "countType": "imageCountMoreThan",
                    "countNumber": POLICY_KEEP,
                },
                "action": {"type": "expire"},
            }
        ]
    }
    if dry_run:
        print(f"  DRY RUN — would set lifecycle policy keep={POLICY_KEEP}")
        return
    aws(
        "ecr", "put-lifecycle-policy",
        "--repository-name", repo,
        "--lifecycle-policy-text", json.dumps(policy),
    )
    print(f"  lifecycle policy installed: keep {POLICY_KEEP}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--keep", type=int, default=5,
        help="images to keep in the bulk delete (default 5, a safety margin "
             "over the policy's 3 in case a deploy is in flight)",
    )
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.keep < POLICY_KEEP:
        print(f"refusing --keep {args.keep}: below the policy floor of {POLICY_KEEP}")
        return 2

    total_deleted = 0
    total_freed = 0.0
    for repo in REPOS:
        d, g = prune(repo, args.keep, args.dry_run)
        total_deleted += d
        total_freed += g
        install_policy(repo, args.dry_run)

    print(f"\n{'would delete' if args.dry_run else 'deleted'} {total_deleted} images, "
          f"{total_freed:.1f} GB, about ${total_freed * 0.10:.2f}/month")
    return 0


if __name__ == "__main__":
    sys.exit(main())
