import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client

from reconstruct import reconstruct
from mesh_cleanup import clean_mesh


# =========================================================
# ENVIRONMENT
# =========================================================

load_dotenv()


SUPABASE_URL = os.environ[
    "SUPABASE_URL"
]


SUPABASE_SERVICE_ROLE_KEY = os.environ[
    "SUPABASE_SERVICE_ROLE_KEY"
]


SUPABASE_BUCKET = os.getenv(
    "SUPABASE_BUCKET",
    "ear-scans"
)


WORK_ROOT = Path(
    os.getenv(
        "WORK_DIR",
        "./work"
    )
)


RESEND_API_KEY = os.environ[
    "RESEND_API_KEY"
]


HAMMER_CRAFT_EMAIL = os.getenv(
    "HAMMER_CRAFT_EMAIL",
    "waiyin.hammercraft@gmail.com"
)


EMAIL_FROM = os.environ[
    "EMAIL_FROM"
]


POLL_SECONDS = int(
    os.getenv(
        "POLL_SECONDS",
        "15"
    )
)


MIN_IMAGES_PER_EAR = int(
    os.getenv(
        "MIN_IMAGES_PER_EAR",
        "15"
    )
)


WORK_ROOT.mkdir(
    parents=True,
    exist_ok=True
)


supabase = create_client(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY
)


# =========================================================
# HELPERS
# =========================================================

def utc_now():
    return (
        datetime
        .now(
            timezone.utc
        )
        .isoformat()
    )


def update_scan(
    scan_id,
    values
):

    values["updated_at"] = (
        utc_now()
    )

    response = (
        supabase
        .table(
            "ear_scans"
        )
        .update(
            values
        )
        .eq(
            "id",
            scan_id
        )
        .execute()
    )

    return response


# =========================================================
# DOWNLOAD IMAGES
# =========================================================

def download_side(
    user_id,
    scan_id,
    side,
    destination
):

    destination = Path(
        destination
    )

    destination.mkdir(
        parents=True,
        exist_ok=True
    )

    prefix = (
        f"{user_id}/"
        f"{scan_id}/"
        f"{side}"
    )

    print(
        f"Listing storage folder: {prefix}"
    )

    files = (
        supabase
        .storage
        .from_(
            SUPABASE_BUCKET
        )
        .list(
            prefix
        )
    )

    image_files = []

    for file in files:

        name = (
            file.get("name")
            if isinstance(file, dict)
            else getattr(
                file,
                "name",
                None
            )
        )

        if not name:
            continue

        if name.lower().endswith(
            (
                ".jpg",
                ".jpeg"
            )
        ):
            image_files.append(
                name
            )

    if (
        len(image_files) <
        MIN_IMAGES_PER_EAR
    ):
        raise RuntimeError(
            f"{side} ear only has "
            f"{len(image_files)} images. "
            f"Minimum is "
            f"{MIN_IMAGES_PER_EAR}."
        )

    image_files.sort()

    for filename in image_files:

        remote_path = (
            f"{prefix}/"
            f"{filename}"
        )

        print(
            "Downloading:",
            remote_path
        )

        file_bytes = (
            supabase
            .storage
            .from_(
                SUPABASE_BUCKET
            )
            .download(
                remote_path
            )
        )

        local_path = (
            destination /
            filename
        )

        local_path.write_bytes(
            file_bytes
        )

    return len(
        image_files
    )
# =========================================================
# UPLOAD STL
# =========================================================

def upload_stl(
    user_id,
    scan_id,
    side,
    local_path
):

    local_path = Path(
        local_path
    )

    storage_path = (
        f"{user_id}/"
        f"{scan_id}/"
        f"results/"
        f"{side}-ear.stl"
    )

    print(
        "Uploading STL:",
        storage_path
    )

    file_bytes = (
        local_path
        .read_bytes()
    )

    (
        supabase
        .storage
        .from_(
            SUPABASE_BUCKET
        )
        .upload(
            path=storage_path,

            file=file_bytes,

            file_options={
                "content-type":
                    "model/stl",

                "upsert":
                    "true"
            }
        )
    )

    return storage_path


# =========================================================
# SIGNED URL
# =========================================================

def create_signed_url(
    path,
    expires_seconds=86400
):

    result = (
        supabase
        .storage
        .from_(
            SUPABASE_BUCKET
        )
        .create_signed_url(
            path,
            expires_seconds
        )
    )

    if isinstance(
        result,
        dict
    ):

        return (
            result.get(
                "signedURL"
            )
            or
            result.get(
                "signedUrl"
            )
            or
            result.get(
                "signed_url"
            )
        )

    return None
# =========================================================
# CUSTOMER PROFILE
# =========================================================

def get_customer_profile(
    user_id
):

    response = (
        supabase
        .table(
            "profiles"
        )
        .select(
            "full_name,email"
        )
        .eq(
            "id",
            user_id
        )
        .limit(
            1
        )
        .execute()
    )

    if (
        not response.data
    ):
        return {}

    return response.data[0]


# =========================================================
# EMAIL
# =========================================================

def send_completion_email(
    scan,
    left_stl_path,
    right_stl_path
):

    user_id = scan[
        "user_id"
    ]

    profile = (
        get_customer_profile(
            user_id
        )
    )

    customer_name = (
        profile.get(
            "full_name"
        )
        or
        "Hammer Craft Customer"
    )

    customer_email = (
        profile.get(
            "email"
        )
        or
        "Unknown"
    )

    left_url = (
        create_signed_url(
            left_stl_path
        )
    )

    right_url = (
        create_signed_url(
            right_stl_path
        )
    )

    html = f"""
    <div style="
        font-family:
        Arial,sans-serif;
        max-width:700px;
        margin:auto;
    ">

        <h1>
            Hammer Craft Ear Scan Complete
        </h1>

        <p>
            A new ear reconstruction has finished.
        </p>

        <hr>

        <p>
            <strong>Customer:</strong>
            {customer_name}
        </p>

        <p>
            <strong>Email:</strong>
            {customer_email}
        </p>

        <p>
            <strong>User ID:</strong>
            {user_id}
        </p>

        <p>
            <strong>Scan ID:</strong>
            {scan["id"]}
        </p>

        <hr>

        <h2>
            Left Ear
        </h2>

        <p>
            <a href="{left_url}">
                Download left-ear.stl
            </a>
        </p>

        <h2>
            Right Ear
        </h2>

        <p>
            <a href="{right_url}">
                Download right-ear.stl
            </a>
        </p>

        <hr>

        <p style="
            color:#777;
            font-size:12px;
        ">
            Download links expire after 24 hours.
        </p>

    </div>
    """

    response = requests.post(
        "https://api.resend.com/emails",

        headers={
            "Authorization":
                f"Bearer {RESEND_API_KEY}",

            "Content-Type":
                "application/json"
        },

        json={
            "from":
                EMAIL_FROM,

            "to": [
                HAMMER_CRAFT_EMAIL
            ],

            "reply_to":
                customer_email,

            "subject":
                f"Ear STL Ready — {customer_name}",

            "html":
                html
        },

        timeout=30
    )

    response.raise_for_status()

    print(
        "Completion email sent."
    )
    # =========================================================
# PROCESS ONE SIDE
# =========================================================

def process_side(
    scan,
    side,
    workspace
):

    user_id = scan[
        "user_id"
    ]

    scan_id = scan[
        "id"
    ]

    side_root = (
        workspace /
        side
    )

    images_dir = (
        side_root /
        "images"
    )

    reconstruction_dir = (
        side_root /
        "reconstruction"
    )

    output_stl = (
        workspace /
        "results" /
        f"{side}-ear.stl"
    )

    image_count = (
        download_side(
            user_id,
            scan_id,
            side,
            images_dir
        )
    )

    print(
        f"{side}: "
        f"{image_count} images downloaded."
    )

    raw_mesh = (
        reconstruct(
            images_dir,
            reconstruction_dir
        )
    )

    print(
        f"{side}: raw mesh created at "
        f"{raw_mesh}"
    )

    final_stl = (
        clean_mesh(
            raw_mesh,
            output_stl
        )
    )

    print(
        f"{side}: STL created at "
        f"{final_stl}"
    )

    storage_path = (
        upload_stl(
            user_id,
            scan_id,
            side,
            final_stl
        )
    )

    return storage_path


# =========================================================
# PROCESS COMPLETE SCAN
# =========================================================

def process_scan(
    scan
):

    scan_id = scan[
        "id"
    ]

    print(
        "\n\n############################################"
    )

    print(
        "PROCESSING SCAN:",
        scan_id
    )

    print(
        "############################################\n"
    )

    workspace = (
        WORK_ROOT /
        scan_id
    )

    if workspace.exists():
        shutil.rmtree(
            workspace
        )

    workspace.mkdir(
        parents=True,
        exist_ok=True
    )

    update_scan(
        scan_id,
        {
            "status":
                "processing"
        }
    )

    try:

        left_path = (
            process_side(
                scan,
                "left",
                workspace
            )
        )

        right_path = (
            process_side(
                scan,
                "right",
                workspace
            )
        )

        update_scan(
            scan_id,
            {
                "status":
                    "complete",

                "left_stl_path":
                    left_path,

                "right_stl_path":
                    right_path
            }
        )

        send_completion_email(
            scan,
            left_path,
            right_path
        )

        print(
            "SCAN COMPLETE:",
            scan_id
        )

    except Exception as error:

        print(
            "SCAN FAILED:",
            scan_id
        )

        print(
            error
        )

        update_scan(
            scan_id,
            {
                "status":
                    "failed"
            }
        )

        raise


# =========================================================
# FIND WAITING SCANS
# =========================================================

def get_pending_scans():

    response = (
        supabase
        .table(
            "ear_scans"
        )
        .select(
            "*"
        )
        .eq(
            "status",
            "uploaded"
        )
        .order(
            "created_at"
        )
        .limit(
            3
        )
        .execute()
    )

    return (
        response.data
        or []
    )


# =========================================================
# MAIN LOOP
# =========================================================

def main():

    print(
        "Hammer Craft Reconstruction Worker"
    )

    print(
        "Supabase:",
        SUPABASE_URL
    )

    print(
        "Bucket:",
        SUPABASE_BUCKET
    )

    print(
        "Polling every",
        POLL_SECONDS,
        "seconds."
    )

    while True:

        try:

            scans = (
                get_pending_scans()
            )

            if not scans:

                time.sleep(
                    POLL_SECONDS
                )

                continue

            for scan in scans:

                try:

                    process_scan(
                        scan
                    )

                except Exception as error:

                    print(
                        "Processing error:",
                        error
                    )

        except KeyboardInterrupt:

            print(
                "\nWorker stopped."
            )

            break

        except Exception as error:

            print(
                "Worker loop error:",
                error
            )

            time.sleep(
                POLL_SECONDS
            )


if __name__ == "__main__":
    main()