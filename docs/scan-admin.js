/* =========================================================
   HAMMER CRAFT
   EAR SCAN ADMIN / PROCESSOR
========================================================= */


const processorDB =
    window.hcSupabase;


const STORAGE_BUCKET =
    "ear-scans";


let currentAdmin =
    null;


let allScans =
    [];


let pendingDeleteScan =
    null;


let refreshTimer =
    null;



/* =========================================================
   INITIALISE
========================================================= */

async function initialiseProcessor() {

    if (
        !processorDB
    ) {

        showProcessorMessage(
            "Unable to connect to Hammer Craft."
        );

        return;

    }


    const {
        data,
        error
    } =
        await processorDB
            .auth
            .getUser();


    if (
        error
    ) {

        console.error(
            error
        );

    }


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


    /* =====================================================
       CHECK ADMIN
    ===================================================== */

    const {
        data: adminRow,
        error: adminError
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
        adminError
    ) {

        console.error(
            adminError
        );

    }


    if (
        !adminRow
    ) {

        window.location.href =
            "account.html";

        return;

    }


    const emailElement =
        document.getElementById(
            "processorAdminEmail"
        );


    if (
        emailElement
    ) {

        emailElement.textContent =
            currentAdmin.email ||
            "ADMIN";

    }


    await loadProcessorScans();


    refreshTimer =
        window.setInterval(

            loadProcessorScans,

            3000

        );

}



/* =========================================================
   LOAD SCANS
========================================================= */

async function loadProcessorScans() {

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
                processor_accelerator,
                left_stl_path,
                right_stl_path,
                error_message,
                processing_started_at,
                processing_finished_at,
                created_at,
                updated_at
            `)
            .order(
                "created_at",
                {
                    ascending:
                        false
                }
            )
            .limit(
                200
            );


    if (
        error
    ) {

        console.error(
            error
        );


        showProcessorMessage(
            error.message
        );

        return;

    }


    allScans =
        data ||
        [];


    renderProcessorStats();


    renderProcessorScans();

}



/* =========================================================
   STATS
========================================================= */

function renderProcessorStats() {

    function countStatus(
        status
    ) {

        return allScans.filter(
            scan =>
                scan.status ===
                status
        ).length;

    }


    setText(
        "uploadedCount",
        countStatus(
            "uploaded"
        )
    );


    setText(
        "queuedCount",
        countStatus(
            "queued"
        )
    );


    setText(
        "processingCount",
        countStatus(
            "processing"
        )
    );


    setText(
        "completeCount",
        countStatus(
            "complete"
        )
    );


    setText(
        "failedCount",
        countStatus(
            "failed"
        )
    );

}



/* =========================================================
   FILTER
========================================================= */

function getFilteredScans() {

    const filter =
        document.getElementById(
            "processorStatusFilter"
        );


    if (
        !filter
    ) {

        return allScans;

    }


    const status =
        filter.value;


    if (
        !status
    ) {

        return allScans;

    }


    return allScans.filter(
        scan =>
            scan.status ===
            status
    );

}



/* =========================================================
   RENDER SCANS
========================================================= */

function renderProcessorScans() {

    const container =
        document.getElementById(
            "processorScanList"
        );


    if (
        !container
    ) {

        return;

    }


    const scans =
        getFilteredScans();


    container.innerHTML =
        "";


    if (
        scans.length ===
        0
    ) {

        container.innerHTML = `

            <div class="empty-card">

                No ear scans found.

            </div>

        `;

        return;

    }


    scans.forEach(
        scan => {

            container.appendChild(
                createScanCard(
                    scan
                )
            );

        }
    );

}



/* =========================================================
   CREATE SCAN CARD
========================================================= */

function createScanCard(
    scan
) {

    const card =
        document.createElement(
            "article"
        );


    card.className =
        "processor-scan-card";


    const progress =
        Math.max(

            0,

            Math.min(

                100,

                Number(
                    scan.progress_percent ||
                    0
                )

            )

        );


    card.innerHTML = `

        <div class="scan-card-header">

            <div>

                <span class="card-label">
                    EAR SCAN
                </span>

                <h3>

                    ${shortID(
                        scan.id
                    )}

                </h3>

                <div class="scan-full-id">

                    ${escapeHTML(
                        scan.id
                    )}

                </div>

            </div>


            <span
                class="
                    status-badge
                    status-${escapeHTML(
                        scan.status ||
                        "unknown"
                    )}
                "
            >

                ${formatStatus(
                    scan.status
                )}

            </span>

        </div>


        <div class="scan-data-grid">

            <article>

                <span>
                    ORDER
                </span>

                <strong>

                    ${escapeHTML(
                        scan.order_id ||
                        "NOT LINKED"
                    )}

                </strong>

            </article>


            <article>

                <span>
                    PROCESSOR
                </span>

                <strong>

                    ${escapeHTML(
                        scan.processor_name ||
                        "WAITING"
                    )}

                </strong>

            </article>


            <article>

                <span>
                    PLATFORM
                </span>

                <strong>

                    ${escapeHTML(
                        scan.processor_platform ||
                        "—"
                    )}

                </strong>

            </article>


            <article>

                <span>
                    ACCELERATOR
                </span>

                <strong>

                    ${escapeHTML(
                        scan.processor_accelerator ||
                        "—"
                    )}

                </strong>

            </article>

        </div>


        <div class="scan-progress">

            <div class="progress-heading">

                <span>

                    ${escapeHTML(
                        scan.progress_stage ||
                        formatStatus(
                            scan.status
                        )
                    )}

                </span>


                <strong>
                    ${progress}%
                </strong>

            </div>


            <div class="progress-track">

                <div
                    class="progress-fill"
                    style="
                        width:
                        ${progress}%;
                    "
                ></div>

            </div>

        </div>


        ${
            scan.error_message

            ? `

                <div class="scan-error">

                    <strong>
                        ERROR
                    </strong>

                    <p>

                        ${escapeHTML(
                            scan.error_message
                        )}

                    </p>

                </div>

            `

            : ""
        }


        <div class="scan-meta">

            <span>

                CREATED

                ${formatDate(
                    scan.created_at
                )}

            </span>


            <span>

                UPDATED

                ${formatDate(
                    scan.updated_at
                )}

            </span>

        </div>


        <div class="scan-card-actions">

            ${getActionHTML(
                scan
            )}

        </div>

    `;


    /* =====================================================
       PROCESS / RETRY / REPROCESS
    ===================================================== */

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


    /* =====================================================
       LEFT STL
    ===================================================== */

    card
        .querySelector(
            "[data-left-stl]"
        )
        ?.addEventListener(
            "click",
            () =>
                openSTL(
                    scan.left_stl_path
                )
        );


    /* =====================================================
       RIGHT STL
    ===================================================== */

    card
        .querySelector(
            "[data-right-stl]"
        )
        ?.addEventListener(
            "click",
            () =>
                openSTL(
                    scan.right_stl_path
                )
        );


    /* =====================================================
       DELETE
    ===================================================== */

    card
        .querySelector(
            "[data-delete-scan]"
        )
        ?.addEventListener(
            "click",
            () =>
                openDeleteScanModal(
                    scan
                )
        );


    return card;

}



/* =========================================================
   ACTION HTML
========================================================= */

function getActionHTML(
    scan
) {

    let html =
        "";


    if (
        scan.status ===
        "uploaded"
    ) {

        html += `

            <button
                type="button"
                class="primary-button"
                data-process
            >
                PROCESS SCAN →
            </button>

        `;

    }


    else if (
        scan.status ===
        "failed"
    ) {

        html += `

            <button
                type="button"
                class="primary-button"
                data-process
            >
                RETRY PROCESSING →
            </button>

        `;

    }


    else if (
        scan.status ===
        "queued"
    ) {

        html += `

            <button
                type="button"
                class="primary-button"
                disabled
            >
                WAITING FOR PROCESSOR
            </button>

        `;

    }


    else if (
        scan.status ===
        "processing"
    ) {

        html += `

            <button
                type="button"
                class="primary-button"
                disabled
            >
                PROCESSING...
            </button>

        `;

    }


    else if (
        scan.status ===
        "complete"
    ) {

        if (
            scan.left_stl_path
        ) {

            html += `

                <button
                    type="button"
                    class="outline-button"
                    data-left-stl
                >
                    LEFT STL
                </button>

            `;

        }


        if (
            scan.right_stl_path
        ) {

            html += `

                <button
                    type="button"
                    class="outline-button"
                    data-right-stl
                >
                    RIGHT STL
                </button>

            `;

        }


        html += `

            <button
                type="button"
                class="outline-button"
                data-process
            >
                REPROCESS
            </button>

        `;

    }


    /* =====================================================
       DELETE

       Prevent deletion while actively processing.
    ===================================================== */

    if (
        scan.status !==
        "processing"
    ) {

        html += `

            <button
                type="button"
                class="danger-button"
                data-delete-scan
            >
                DELETE SCAN
            </button>

        `;

    }


    return html;

}



/* =========================================================
   QUEUE SCAN
========================================================= */

async function queueScan(
    scanID
) {

    showProcessorMessage(
        "Adding scan to processing queue..."
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

                processor_accelerator:
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

        console.error(
            error
        );


        showProcessorMessage(
            error.message
        );

        return;

    }


    showProcessorMessage(
        "Scan queued successfully."
    );


    await loadProcessorScans();

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

        showProcessorMessage(
            "No STL file is available."
        );

        return;

    }


    showProcessorMessage(
        "Creating secure STL link..."
    );


    const {
        data,
        error
    } =
        await processorDB
            .storage
            .from(
                STORAGE_BUCKET
            )
            .createSignedUrl(
                path,
                600
            );


    if (
        error
    ) {

        console.error(
            error
        );


        showProcessorMessage(
            error.message
        );

        return;

    }


    showProcessorMessage(
        ""
    );


    window.open(
        data.signedUrl,
        "_blank",
        "noopener,noreferrer"
    );

}



/* =========================================================
   DELETE MODAL
========================================================= */

function openDeleteScanModal(
    scan
) {

    if (
        scan.status ===
        "processing"
    ) {

        showProcessorMessage(
            "A scan cannot be deleted while it is processing."
        );

        return;

    }


    pendingDeleteScan =
        scan;


    setText(
        "deleteScanId",
        scan.id
    );


    const modal =
        document.getElementById(
            "deleteScanModal"
        );


    if (
        !modal
    ) {

        return;

    }


    modal.classList.add(
        "open"
    );


    modal.setAttribute(
        "aria-hidden",
        "false"
    );

}



/* =========================================================
   CLOSE DELETE MODAL
========================================================= */

function closeDeleteScanModal() {

    pendingDeleteScan =
        null;


    const modal =
        document.getElementById(
            "deleteScanModal"
        );


    if (
        !modal
    ) {

        return;

    }


    modal.classList.remove(
        "open"
    );


    modal.setAttribute(
        "aria-hidden",
        "true"
    );

}



/* =========================================================
   DELETE SCAN DIRECTLY
   NO EDGE FUNCTION REQUIRED
========================================================= */

async function deleteScanDirectly(
    scan
) {

    if (
        !scan?.id
    ) {

        throw new Error(
            "Invalid scan."
        );

    }


    if (
        scan.status ===
        "processing"
    ) {

        throw new Error(
            "This scan is currently processing."
        );

    }


    const userID =
        scan.user_id;


    const scanID =
        scan.id;


    if (
        !userID
    ) {

        throw new Error(
            "Scan owner is missing."
        );

    }


    const bucket =
        processorDB
            .storage
            .from(
                STORAGE_BUCKET
            );


    const rootPath =
        `${userID}/${scanID}`;


    const pathsToDelete =
        [];


    /* =====================================================
       RECURSIVE STORAGE LIST
    ===================================================== */

    async function collectFolder(
        folder
    ) {

        let offset =
            0;


        const limit =
            100;


        while (
            true
        ) {

            const {
                data,
                error
            } =
                await bucket
                    .list(
                        folder,
                        {

                            limit,

                            offset,

                            sortBy: {

                                column:
                                    "name",

                                order:
                                    "asc",

                            },

                        }
                    );


            if (
                error
            ) {

                throw error;

            }


            const entries =
                data ||
                [];


            if (
                entries.length ===
                0
            ) {

                break;

            }


            for (
                const entry
                of entries
            ) {

                const path =
                    `${folder}/${entry.name}`;


                /*
                 * In Supabase Storage, folder-like entries
                 * usually have no object id.
                 */

                const looksLikeFolder =
                    !entry.id;


                if (
                    looksLikeFolder
                ) {

                    await collectFolder(
                        path
                    );

                }

                else {

                    pathsToDelete.push(
                        path
                    );

                }

            }


            if (
                entries.length <
                limit
            ) {

                break;

            }


            offset +=
                limit;

        }

    }


    /* =====================================================
       FIND EVERYTHING UNDER THIS SCAN
    ===================================================== */

    await collectFolder(
        rootPath
    );


    console.log(
        "Storage files to delete:",
        pathsToDelete
    );


    /* =====================================================
       DELETE STORAGE FIRST
    ===================================================== */

    const batchSize =
        100;


    for (
        let index = 0;
        index <
        pathsToDelete.length;
        index += batchSize
    ) {

        const batch =
            pathsToDelete.slice(
                index,
                index +
                batchSize
            );


        const {
            error
        } =
            await bucket
                .remove(
                    batch
                );


        if (
            error
        ) {

            throw error;

        }

    }


    /* =====================================================
       DELETE DATABASE RECORD LAST
    ===================================================== */

    const {
        error: deleteError
    } =
        await processorDB
            .from(
                "ear_scans"
            )
            .delete()
            .eq(
                "id",
                scanID
            );


    if (
        deleteError
    ) {

        throw deleteError;

    }


    return {

        success:
            true,

        filesDeleted:
            pathsToDelete.length,

    };

}



/* =========================================================
   CONFIRM DELETE
========================================================= */

async function deleteSelectedScan() {

    if (
        !pendingDeleteScan
    ) {

        return;

    }


    const button =
        document.getElementById(
            "confirmDeleteScanButton"
        );


    if (
        button
    ) {

        button.disabled =
            true;


        button.textContent =
            "DELETING...";

    }


    try {

        const result =
            await deleteScanDirectly(
                pendingDeleteScan
            );


        closeDeleteScanModal();


        showProcessorMessage(

            `Scan deleted successfully. ${
                result.filesDeleted
            } files removed.`

        );


        await loadProcessorScans();

    }

    catch (
        error
    ) {

        console.error(
            error
        );


        showProcessorMessage(

            error.message ||
            "Unable to delete scan."

        );

    }

    finally {

        if (
            button
        ) {

            button.disabled =
                false;


            button.textContent =
                "DELETE SCAN";

        }

    }

}



/* =========================================================
   MESSAGE
========================================================= */

function showProcessorMessage(
    message
) {

    const element =
        document.getElementById(
            "processorMessage"
        );


    if (
        element
    ) {

        element.textContent =
            message ||
            "";

    }

}



/* =========================================================
   SET TEXT
========================================================= */

function setText(
    id,
    value
) {

    const element =
        document.getElementById(
            id
        );


    if (
        element
    ) {

        element.textContent =
            value;

    }

}



/* =========================================================
   FORMAT STATUS
========================================================= */

function formatStatus(
    status
) {

    return String(
        status ||
        "unknown"
    )
        .replaceAll(
            "_",
            " "
        )
        .toUpperCase();

}



/* =========================================================
   FORMAT DATE
========================================================= */

function formatDate(
    value
) {

    if (
        !value
    ) {

        return "—";

    }


    try {

        return new Date(
            value
        )
        .toLocaleString(
            "en-GB"
        );

    }

    catch {

        return String(
            value
        );

    }

}



/* =========================================================
   SHORT ID
========================================================= */

function shortID(
    value
) {

    if (
        !value
    ) {

        return "UNKNOWN";

    }


    return String(
        value
    )
        .slice(
            0,
            8
        )
        .toUpperCase();

}



/* =========================================================
   ESCAPE HTML
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
   EVENT BINDING
========================================================= */

const refreshButton =
    document.getElementById(
        "processorRefreshButton"
    );


if (
    refreshButton
) {

    refreshButton.addEventListener(
        "click",
        loadProcessorScans
    );

}


const statusFilter =
    document.getElementById(
        "processorStatusFilter"
    );


if (
    statusFilter
) {

    statusFilter.addEventListener(
        "change",
        renderProcessorScans
    );

}


const cancelDeleteButton =
    document.getElementById(
        "cancelDeleteScanButton"
    );


if (
    cancelDeleteButton
) {

    cancelDeleteButton.addEventListener(
        "click",
        closeDeleteScanModal
    );

}


const confirmDeleteButton =
    document.getElementById(
        "confirmDeleteScanButton"
    );


if (
    confirmDeleteButton
) {

    confirmDeleteButton.addEventListener(
        "click",
        deleteSelectedScan
    );

}


const modalBackdrop =
    document.querySelector(
        "#deleteScanModal .modal-backdrop"
    );


if (
    modalBackdrop
) {

    modalBackdrop.addEventListener(
        "click",
        closeDeleteScanModal
    );

}


document.addEventListener(
    "keydown",
    event => {

        if (
            event.key ===
            "Escape"
        ) {

            closeDeleteScanModal();

        }

    }
);



/* =========================================================
   CLEANUP
========================================================= */

window.addEventListener(
    "beforeunload",
    () => {

        if (
            refreshTimer
        ) {

            clearInterval(
                refreshTimer
            );

        }

    }
);



/* =========================================================
   START
========================================================= */

initialiseProcessor();