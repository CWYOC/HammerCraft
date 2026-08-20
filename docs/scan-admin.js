const processorDB =
    window.hcSupabase;


let currentAdmin =
    null;


let scanRefreshTimer =
    null;



/* =========================================================
   START
========================================================= */

async function initialiseProcessorPage() {

    if (
        !processorDB
    ) {

        showMessage(
            "Supabase unavailable."
        );

        return;
    }


    const {
        data
    } =
        await processorDB
            .auth
            .getUser();


    currentAdmin =
        data?.user ||
        null;


    if (
        !currentAdmin
    ) {

        window.location.href =
            `login.html?redirect=${
                encodeURIComponent(
                    window.location.href
                )
            }`;

        return;
    }


    const {
        data: adminRow,
        error
    } =
        await processorDB
            .from(
                "admin_users"
            )
            .select(
                "user_id"
            )
            .eq(
                "user_id",
                currentAdmin.id
            )
            .maybeSingle();


    if (
        error ||
        !adminRow
    ) {

        window.location.href =
            "account.html";

        return;
    }


    await loadScans();


    scanRefreshTimer =
        window.setInterval(
            loadScans,
            3000
        );

}



/* =========================================================
   LOAD
========================================================= */

async function loadScans() {

    const {
        data,
        error
    } =
        await processorDB
            .from(
                "ear_scans"
            )
            .select(`
                id,
                user_id,
                order_id,
                status,
                progress_percent,
                progress_stage,
                processor_name,
                processor_platform,
                left_stl_path,
                right_stl_path,
                error_message,
                created_at,
                updated_at,
                processing_started_at,
                processing_finished_at
            `)
            .order(
                "created_at",
                {
                    ascending:
                        false
                }
            )
            .limit(
                100
            );


    if (
        error
    ) {

        console.error(
            error
        );


        showMessage(
            error.message
        );

        return;
    }


    renderScans(
        data ||
        []
    );

}



/* =========================================================
   COUNTS
========================================================= */

function renderCounts(
    scans
) {

    const count =
        status =>
            scans
                .filter(
                    scan =>
                        scan.status ===
                        status
                )
                .length;


    document
        .getElementById(
            "queuedCount"
        )
        .textContent =
        count(
            "queued"
        );


    document
        .getElementById(
            "processingCount"
        )
        .textContent =
        count(
            "processing"
        );


    document
        .getElementById(
            "completeCount"
        )
        .textContent =
        count(
            "complete"
        );


    document
        .getElementById(
            "failedCount"
        )
        .textContent =
        count(
            "failed"
        );

}



/* =========================================================
   RENDER
========================================================= */

function renderScans(
    scans
) {

    renderCounts(
        scans
    );


    const container =
        document.getElementById(
            "scanList"
        );


    if (
        scans.length ===
        0
    ) {

        container.innerHTML =
            "No ear scans found.";

        return;
    }


    container.innerHTML =
        "";


    scans.forEach(
        scan => {

            const card =
                document.createElement(
                    "article"
                );


            card.className =
                "scan-card";


            const percent =
                Number(
                    scan.progress_percent ||
                    0
                );


            card.innerHTML = `

                <div class="scan-card-top">

                    <div>

                        <strong>
                            EAR SCAN
                        </strong>

                        <div class="scan-id">

                            ${escapeHTML(
                                scan.id
                            )}

                        </div>

                    </div>


                    <span class="scan-status">

                        ${formatStatus(
                            scan.status
                        )}

                    </span>

                </div>


                <div class="scan-info">

                    <div>

                        <span>
                            ORDER
                        </span>

                        <strong>

                            ${
                                escapeHTML(
                                    scan.order_id ||
                                    "Not linked"
                                )
                            }

                        </strong>

                    </div>


                    <div>

                        <span>
                            PROCESSOR
                        </span>

                        <strong>

                            ${
                                escapeHTML(
                                    scan.processor_name ||
                                    "Waiting"
                                )
                            }

                        </strong>

                    </div>


                    <div>

                        <span>
                            PLATFORM
                        </span>

                        <strong>

                            ${
                                escapeHTML(
                                    scan.processor_platform ||
                                    "—"
                                )
                            }

                        </strong>

                    </div>


                    <div>

                        <span>
                            CREATED
                        </span>

                        <strong>

                            ${
                                new Date(
                                    scan.created_at
                                )
                                .toLocaleString(
                                    "en-GB"
                                )
                            }

                        </strong>

                    </div>

                </div>


                <div class="progress-area">

                    <div class="progress-top">

                        <span>

                            ${
                                escapeHTML(
                                    scan.progress_stage ||
                                    formatStatus(
                                        scan.status
                                    )
                                )
                            }

                        </span>


                        <strong>
                            ${percent}%
                        </strong>

                    </div>


                    <div class="progress-track">

                        <div
                            class="progress-bar"
                            style="
                                width:
                                ${percent}%;
                            "
                        ></div>

                    </div>

                </div>


                ${
                    scan.error_message

                    ? `

                        <div class="scan-error">

                            ${escapeHTML(
                                scan.error_message
                            )}

                        </div>

                    `

                    : ""
                }


                <div class="scan-actions">

                    ${actionsHTML(
                        scan
                    )}

                </div>

            `;


            bindCardButtons(
                card,
                scan
            );


            container.appendChild(
                card
            );

        }
    );

}



/* =========================================================
   BUTTON HTML
========================================================= */

function actionsHTML(
    scan
) {

    if (
        scan.status ===
        "uploaded"
    ) {

        return `

            <button
                type="button"
                data-process
            >
                PROCESS SCAN →
            </button>

        `;

    }


    if (
        scan.status ===
        "failed"
    ) {

        return `

            <button
                type="button"
                data-process
            >
                RETRY PROCESSING →
            </button>

        `;

    }


    if (
        scan.status ===
        "queued"
    ) {

        return `

            <button
                type="button"
                disabled
            >
                WAITING FOR LOCAL PROCESSOR
            </button>

        `;

    }


    if (
        scan.status ===
        "processing"
    ) {

        return `

            <button
                type="button"
                disabled
            >
                PROCESSING...
            </button>

        `;

    }


    if (
        scan.status ===
        "complete"
    ) {

        return `

            ${
                scan.left_stl_path

                ? `

                    <button
                        type="button"
                        class="secondary"
                        data-left
                    >
                        OPEN LEFT STL
                    </button>

                `

                : ""
            }


            ${
                scan.right_stl_path

                ? `

                    <button
                        type="button"
                        class="secondary"
                        data-right
                    >
                        OPEN RIGHT STL
                    </button>

                `

                : ""
            }


            <button
                type="button"
                data-process
            >
                REPROCESS
            </button>

        `;

    }


    return "";

}



/* =========================================================
   BIND BUTTONS
========================================================= */

function bindCardButtons(
    card,
    scan
) {

    card
        .querySelector(
            "[data-process]"
        )
        ?.addEventListener(
            "click",
            () =>
                queueScan(
                    scan.id
                )
        );


    card
        .querySelector(
            "[data-left]"
        )
        ?.addEventListener(
            "click",
            () =>
                openSTL(
                    scan.left_stl_path
                )
        );


    card
        .querySelector(
            "[data-right]"
        )
        ?.addEventListener(
            "click",
            () =>
                openSTL(
                    scan.right_stl_path
                )
        );

}



/* =========================================================
   QUEUE
========================================================= */

async function queueScan(
    scanID
) {

    showMessage(
        "Adding scan to local processing queue..."
    );


    const {
        error
    } =
        await processorDB
            .from(
                "ear_scans"
            )
            .update({

                status:
                    "queued",

                progress_percent:
                    0,

                progress_stage:
                    "Waiting for local processor",

                processor_name:
                    null,

                processor_platform:
                    null,

                processing_started_at:
                    null,

                processing_finished_at:
                    null,

                error_message:
                    null,

                updated_at:
                    new Date()
                        .toISOString()

            })
            .eq(
                "id",
                scanID
            );


    if (
        error
    ) {

        showMessage(
            error.message
        );

        return;
    }


    showMessage(
        "Scan queued."
    );


    await loadScans();

}



/* =========================================================
   OPEN STL
========================================================= */

async function openSTL(
    path
) {

    if (
        !path
    ) {

        return;
    }


    const {
        data,
        error
    } =
        await processorDB
            .storage
            .from(
                "ear-scans"
            )
            .createSignedUrl(
                path,
                600
            );


    if (
        error
    ) {

        showMessage(
            error.message
        );

        return;
    }


    window.open(
        data.signedUrl,
        "_blank",
        "noopener,noreferrer"
    );

}



/* =========================================================
   MESSAGE
========================================================= */

function showMessage(
    message
) {

    document
        .getElementById(
            "processorMessage"
        )
        .textContent =
        message ||
        "";

}



/* =========================================================
   FORMAT
========================================================= */

function formatStatus(
    value
) {

    return String(
        value ||
        ""
    )
        .replaceAll(
            "_",
            " "
        )
        .toUpperCase();

}



/* =========================================================
   ESCAPE
========================================================= */

function escapeHTML(
    value
) {

    return String(
        value ??
        ""
    )
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );

}



/* =========================================================
   REFRESH
========================================================= */

document
    .getElementById(
        "refreshButton"
    )
    .addEventListener(
        "click",
        loadScans
    );



/* =========================================================
   STOP TIMER
========================================================= */

window.addEventListener(
    "beforeunload",
    () => {

        if (
            scanRefreshTimer
        ) {

            clearInterval(
                scanRefreshTimer
            );

        }

    }
);



/* =========================================================
   START
========================================================= */

initialiseProcessorPage();