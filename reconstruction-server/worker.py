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
# DATABASE UPDATE
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


    except Exception as error:

        # Compatibility fallback if the
        # processor_accelerator column has not
        # been created yet.

        if (
            "processor_accelerator"
            in values
        ):

            values.pop(
                "processor_accelerator"
            )


            update_scan(
                scan_id,
                values,
            )

        else:

            raise error


# =========================================================
# DOWNLOAD EAR IMAGES
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


    prefix = (
        f"{user_id}/"
        f"{scan_id}/"
        f"{side}"
    )


    print(
        "\nStorage folder:",
        prefix,
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

        if isinstance(
            file,
            dict,
        ):

            name = file.get(
                "name"
            )

        else:

            name = getattr(
                file,
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

            image_files.append(
                name
            )


    image_files.sort()


    count = len(
        image_files
    )


    print(
        f"{side}: "
        f"{count} images found."
    )


    if (
        count <
        MIN_IMAGES_PER_EAR
    ):

        raise RuntimeError(

            f"{side} ear has "
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
            f"but {count} images will "
            f"be processed."
        )


    for (
        index,
        filename,
    ) in enumerate(
        image_files,
        start=1,
    ):

        remote_path = (
            f"{prefix}/"
            f"{filename}"
        )


        print(
            f"Downloading "
            f"{side} "
            f"{index}/{count}: "
            f"{filename}"
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
            destination
            /
            filename
        )


        local_path.write_bytes(
            file_bytes
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
            f"STL does not exist: "
            f"{local_path}"
        )


    remote_path = (
        f"{user_id}/"
        f"{scan_id}/"
        f"results/"
        f"{side}-ear.stl"
    )


    print(
        "\nUploading STL:",
        remote_path,
    )


    bucket = (
        supabase
        .storage
        .from_(
            SUPABASE_BUCKET
        )
    )


    # Reprocessing support
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


    # -----------------------------------------------------
    # DOWNLOAD
    # -----------------------------------------------------

    set_progress(

        scan_id,

        progress_start,

        f"Downloading "
        f"{side_title.lower()} "
        f"ear images",

    )


    image_count = (
        download_side(

            user_id,
            scan_id,
            side,
            images_dir,

        )
    )


    print(
        f"{side_title}: "
        f"{image_count} images downloaded."
    )


    # -----------------------------------------------------
    # RECONSTRUCTION PROGRESS
    # -----------------------------------------------------

    reconstruction_range = (
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
                reconstruction_range
                *
                relative_percent
                /
                100
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


    # -----------------------------------------------------
    # RECONSTRUCTION
    # -----------------------------------------------------

    raw_mesh = reconstruct(

        images_dir,
        reconstruction_dir,

        progress_callback=
            reconstruction_progress,

    )


    if (
        not Path(
            raw_mesh
        )
        .exists()
    ):

        raise RuntimeError(
            f"{side_title} reconstruction "
            f"did not produce a raw mesh."
        )


    # -----------------------------------------------------
    # CLEANUP
    # -----------------------------------------------------

    set_progress(

        scan_id,

        progress_end - 3,

        f"Repairing "
        f"{side_title.lower()} "
        f"ear mesh",

    )


    final_stl = clean_mesh(

        raw_mesh,
        output_stl,

        force_solid=
            True,

        voxel_resolution=
            MESH_VOXEL_RESOLUTION,

    )


    # -----------------------------------------------------
    # UPLOAD
    # -----------------------------------------------------

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

    old_status = scan[
        "status"
    ]


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
            old_status
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


    if (
        not claim_scan(
            scan
        )
    ):

        print(
            "Job already claimed:",
            scan_id
        )

        return


    print(
        "\n"
        "############################################"
    )


    print(
        "HAMMER CRAFT EAR RECONSTRUCTION"
    )


    print(
        "SCAN:",
        scan_id
    )


    print(
        "PROCESSOR:",
        PROCESSOR_NAME
    )


    print(
        "PLATFORM:",
        PROCESSOR_PLATFORM
    )


    print(
        "############################################"
        "\n"
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

        # -------------------------------------------------
        # LEFT
        # -------------------------------------------------

        left_path = process_side(

            scan,
            "left",
            workspace,

            4,
            48,

        )


        # -------------------------------------------------
        # RIGHT
        # -------------------------------------------------

        right_path = process_side(

            scan,
            "right",
            workspace,

            52,
            96,

        )


        # -------------------------------------------------
        # COMPLETE
        # -------------------------------------------------

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
# MAIN LOOP
# =========================================================

def main():

    print(
        "\n"
        "Hammer Craft Local Reconstruction Processor"
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
        "Supabase:",
        SUPABASE_URL
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
        "Automatically process uploaded scans:",
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

            scans = (
                get_pending_scans()
            )


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