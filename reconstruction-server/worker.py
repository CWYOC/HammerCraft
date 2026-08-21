import os
import platform
import shutil
import socket
import time

from datetime import datetime, timezone
from pathlib import Path

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
    "ear-scans",
)


WORK_ROOT = Path(
    os.getenv(
        "WORK_DIR",
        "./work",
    )
)


POLL_SECONDS = int(
    os.getenv(
        "POLL_SECONDS",
        "5",
    )
)


TARGET_IMAGES_PER_EAR = int(
    os.getenv(
        "TARGET_IMAGES_PER_EAR",
        "120",
    )
)


MIN_IMAGES_PER_EAR = int(
    os.getenv(
        "MIN_IMAGES_PER_EAR",
        "90",
    )
)


MESH_VOXEL_RESOLUTION = int(
    os.getenv(
        "MESH_VOXEL_RESOLUTION",
        "350",
    )
)


AUTO_PROCESS_UPLOADED = (
    os.getenv(
        "AUTO_PROCESS_UPLOADED",
        "false",
    )
    .strip()
    .lower()
    in (
        "1",
        "true",
        "yes",
        "on",
    )
)


PROCESSOR_NAME = os.getenv(
    "PROCESSOR_NAME",
    socket.gethostname(),
)


PROCESSOR_PLATFORM = (
    f"{platform.system()} "
    f"{platform.machine()}"
)


WORK_ROOT.mkdir(
    parents=True,
    exist_ok=True,
)


supabase = create_client(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
)


# =========================================================
# TIME
# =========================================================

def utc_now():

    return (
        datetime
        .now(
            timezone.utc
        )
        .isoformat()
    )


# =========================================================
# DATABASE
# =========================================================

def update_scan(
    scan_id,
    values,
):

    values[
        "updated_at"
    ] = utc_now()


    return (
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


# =========================================================
# PROGRESS
# =========================================================

def set_progress(
    scan_id,
    percent,
    stage,
    accelerator=None,
):

    percent = max(
        0,
        min(
            100,
            int(
                percent
            ),
        ),
    )


    print(
        f"[{percent:3d}%] {stage}",
        flush=True,
    )


    values = {

        "progress_percent":
            percent,

        "progress_stage":
            stage,

        "processor_name":
            PROCESSOR_NAME,

        "processor_platform":
            PROCESSOR_PLATFORM,

    }


    if accelerator:

        values[
            "processor_accelerator"
        ] = accelerator


    try:

        update_scan(
            scan_id,
            values,
        )


    except Exception:

        # Allows compatibility with databases that
        # do not yet contain processor_accelerator.

        values.pop(
            "processor_accelerator",
            None,
        )


        update_scan(
            scan_id,
            values,
        )


# =========================================================
# STORAGE IMAGE LIST
# =========================================================

def get_storage_images(
    user_id,
    scan_id,
    side,
):

    prefix = (
        f"{user_id}/"
        f"{scan_id}/"
        f"{side}"
    )


    entries = (
        supabase
        .storage
        .from_(
            SUPABASE_BUCKET
        )
        .list(
            prefix
        )
    )


    filenames = []


    for entry in entries:

        if isinstance(
            entry,
            dict,
        ):

            name = entry.get(
                "name"
            )

        else:

            name = getattr(
                entry,
                "name",
                None,
            )


        if not name:

            continue


        if name.lower().endswith(
            (
                ".jpg",
                ".jpeg",
                ".png",
            )
        ):

            filenames.append(
                name
            )


    filenames.sort()


    return (
        prefix,
        filenames,
    )


# =========================================================
# DOWNLOAD EAR
# =========================================================

def download_side(
    user_id,
    scan_id,
    side,
    destination,
):

    destination = Path(
        destination
    )


    destination.mkdir(
        parents=True,
        exist_ok=True,
    )


    (
        prefix,
        filenames,
    ) = get_storage_images(
        user_id,
        scan_id,
        side,
    )


    count = len(
        filenames
    )


    print(
        f"\n{side.upper()} EAR"
    )


    print(
        "Storage:",
        prefix,
    )


    print(
        "Images:",
        count,
    )


    if (
        count <
        MIN_IMAGES_PER_EAR
    ):

        raise RuntimeError(

            f"{side} ear has only "
            f"{count} images. "

            f"Minimum required is "
            f"{MIN_IMAGES_PER_EAR}."

        )


    if (
        count <
        TARGET_IMAGES_PER_EAR
    ):

        print(

            f"WARNING: target is "
            f"{TARGET_IMAGES_PER_EAR}, "
            f"using {count}."

        )


    bucket = (
        supabase
        .storage
        .from_(
            SUPABASE_BUCKET
        )
    )


    for (
        index,
        filename,
    ) in enumerate(
        filenames,
        start=1,
    ):

        remote_path = (
            f"{prefix}/"
            f"{filename}"
        )


        print(
            f"Downloading "
            f"{index}/{count}: "
            f"{filename}"
        )


        data = bucket.download(
            remote_path
        )


        local_path = (
            destination
            /
            filename
        )


        local_path.write_bytes(
            data
        )


    return count


# =========================================================
# UPLOAD STL
# =========================================================

def upload_stl(
    user_id,
    scan_id,
    side,
    local_path,
):

    local_path = Path(
        local_path
    )


    if (
        not local_path.exists()
    ):

        raise RuntimeError(
            f"STL missing: "
            f"{local_path}"
        )


    remote_path = (

        f"{user_id}/"
        f"{scan_id}/"
        f"results/"
        f"{side}-ear.stl"

    )


    bucket = (
        supabase
        .storage
        .from_(
            SUPABASE_BUCKET
        )
    )


    try:

        bucket.remove(
            [
                remote_path
            ]
        )

    except Exception:

        pass


    bucket.upload(

        path=
            remote_path,

        file=
            local_path.read_bytes(),

        file_options={

            "content-type":
                "model/stl",

        },

    )


    print(
        "Uploaded STL:",
        remote_path,
    )


    return remote_path


# =========================================================
# PROCESS ONE EAR
# =========================================================

def process_side(
    scan,
    side,
    workspace,
    progress_start,
    progress_end,
):

    scan_id = scan[
        "id"
    ]


    user_id = scan[
        "user_id"
    ]


    side_title = (
        "Left"
        if side ==
        "left"
        else "Right"
    )


    side_root = (
        workspace
        /
        side
    )


    images_dir = (
        side_root
        /
        "images"
    )


    reconstruction_dir = (
        side_root
        /
        "reconstruction"
    )


    output_stl = (

        workspace
        /
        "results"
        /
        f"{side}-ear.stl"

    )


    output_stl.parent.mkdir(
        parents=True,
        exist_ok=True,
    )


    set_progress(

        scan_id,

        progress_start,

        f"Downloading "
        f"{side_title.lower()} "
        f"ear images",

    )


    image_count = download_side(

        user_id,
        scan_id,
        side,
        images_dir,

    )


    print(
        f"{side_title}: "
        f"{image_count} images downloaded."
    )


    progress_range = (
        progress_end
        -
        progress_start
    )


    def reconstruction_progress(
        relative_percent,
        stage,
        accelerator=None,
    ):

        relative_percent = max(
            0,
            min(
                100,
                float(
                    relative_percent
                ),
            ),
        )


        overall = (

            progress_start

            +

            (
                progress_range
                *
                relative_percent
                /
                100.0
            )

        )


        set_progress(

            scan_id,

            overall,

            f"{side_title}: "
            f"{stage}",

            accelerator=
                accelerator,

        )


    raw_mesh = reconstruct(

        images_dir,
        reconstruction_dir,

        progress_callback=
            reconstruction_progress,

    )


    raw_mesh = Path(
        raw_mesh
    )


    if (
        not raw_mesh.exists()
    ):

        raise RuntimeError(
            f"{side_title} reconstruction "
            f"did not create a mesh."
        )


    set_progress(

        scan_id,

        progress_end - 3,

        f"Cleaning "
        f"{side_title.lower()} mesh",

    )


    final_stl = clean_mesh(

        raw_mesh,
        output_stl,

        force_solid=
            True,

        voxel_resolution=
            MESH_VOXEL_RESOLUTION,

    )


    set_progress(

        scan_id,

        progress_end - 1,

        f"Uploading "
        f"{side_title.lower()} STL",

    )


    return upload_stl(

        user_id,
        scan_id,
        side,
        final_stl,

    )


# =========================================================
# CLAIM JOB
# =========================================================

def claim_scan(
    scan,
):

    response = (

        supabase
        .table(
            "ear_scans"
        )
        .update({

            "status":
                "processing",

            "progress_percent":
                1,

            "progress_stage":
                "Preparing local reconstruction",

            "processor_name":
                PROCESSOR_NAME,

            "processor_platform":
                PROCESSOR_PLATFORM,

            "processing_started_at":
                utc_now(),

            "processing_finished_at":
                None,

            "error_message":
                None,

            "updated_at":
                utc_now(),

        })
        .eq(
            "id",
            scan[
                "id"
            ]
        )
        .eq(
            "status",
            scan[
                "status"
            ]
        )
        .execute()

    )


    if (
        response.data
        is not None
        and
        len(
            response.data
        )
        ==
        0
    ):

        return False


    return True


# =========================================================
# PROCESS FULL SCAN
# =========================================================

def process_scan(
    scan,
):

    scan_id = scan[
        "id"
    ]


    if not claim_scan(
        scan
    ):

        print(
            "Scan already claimed:",
            scan_id,
        )

        return


    print(
        "\n"
        "=============================================="
    )


    print(
        " HAMMER CRAFT EAR RECONSTRUCTION"
    )


    print(
        "=============================================="
    )


    print(
        "Scan:",
        scan_id
    )


    print(
        "Processor:",
        PROCESSOR_NAME
    )


    print(
        "Platform:",
        PROCESSOR_PLATFORM
    )


    workspace = (
        WORK_ROOT
        /
        scan_id
    )


    if workspace.exists():

        shutil.rmtree(
            workspace
        )


    workspace.mkdir(
        parents=True,
        exist_ok=True,
    )


    try:

        left_path = process_side(

            scan,
            "left",
            workspace,

            4,
            48,

        )


        right_path = process_side(

            scan,
            "right",
            workspace,

            52,
            96,

        )


        update_scan(
            scan_id,
            {

                "status":
                    "complete",

                "progress_percent":
                    100,

                "progress_stage":
                    "Reconstruction complete",

                "left_stl_path":
                    left_path,

                "right_stl_path":
                    right_path,

                "processing_finished_at":
                    utc_now(),

                "error_message":
                    None,

            },
        )


        print(
            "\nSCAN COMPLETE:",
            scan_id
        )


    except Exception as error:

        print(
            "\nSCAN FAILED:",
            scan_id
        )


        print(
            error
        )


        update_scan(
            scan_id,
            {

                "status":
                    "failed",

                "progress_stage":
                    "Reconstruction failed",

                "processing_finished_at":
                    utc_now(),

                "error_message":
                    str(
                        error
                    )[:10000],

            },
        )


# =========================================================
# QUEUE
# =========================================================

def get_pending_scans():

    statuses = [
        "queued"
    ]


    if AUTO_PROCESS_UPLOADED:

        statuses.append(
            "uploaded"
        )


    response = (

        supabase
        .table(
            "ear_scans"
        )
        .select(
            "*"
        )
        .in_(
            "status",
            statuses
        )
        .order(
            "updated_at"
        )
        .limit(
            1
        )
        .execute()

    )


    return (
        response.data
        or []
    )


# =========================================================
# MAIN
# =========================================================

def main():

    print(
        "\nHammer Craft Local Reconstruction Processor"
    )


    print(
        "Processor:",
        PROCESSOR_NAME
    )


    print(
        "Platform:",
        PROCESSOR_PLATFORM
    )


    print(
        "Bucket:",
        SUPABASE_BUCKET
    )


    print(
        "Work directory:",
        WORK_ROOT.resolve()
    )


    print(
        "Target images per ear:",
        TARGET_IMAGES_PER_EAR
    )


    print(
        "Minimum images per ear:",
        MIN_IMAGES_PER_EAR
    )


    print(
        "Automatically process uploaded:",
        AUTO_PROCESS_UPLOADED
    )


    print(
        "Polling every",
        POLL_SECONDS,
        "seconds."
    )


    print(
        "\nWaiting for reconstruction jobs..."
    )


    while True:

        try:

            scans = get_pending_scans()


            if not scans:

                time.sleep(
                    POLL_SECONDS
                )

                continue


            for scan in scans:

                process_scan(
                    scan
                )


        except KeyboardInterrupt:

            print(
                "\nWorker stopped."
            )

            break


        except Exception as error:

            print(
                "\nWorker loop error:"
            )


            print(
                error
            )


            time.sleep(
                POLL_SECONDS
            )


if __name__ == "__main__":

    main()