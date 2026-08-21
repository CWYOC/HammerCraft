/* =========================================================
   HAMMER CRAFT
   EAR SCAN ADMIN / PROCESSOR

   Compatible with older and newer scan-admin.html
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
   ELEMENT HELPERS
========================================================= */

function getFirstElement(
    ...ids
) {

    for (
        const id
        of ids
    ) {

        const element =
            document.getElementById(
                id
            );


        if (
            element
        ) {

            return element;

        }

    }


    return null;

}



function setText(
    ids,
    value
) {

    const list =
        Array.isArray(
            ids
        )
        ? ids
        : [
            ids
        ];


    const element =
        getFirstElement(
            ...list
        );


    if (
        element
    ) {

        element.textContent =
            value;

    }

}



/* =========================================================
   INITIALISE
========================================================= */

async function initialiseProcessor() {

    console.log(
        "Hammer Craft scan processor starting..."
    );


    if (
        !processorDB
    ) {

        showProcessorMessage(
            "Unable to connect to Hammer Craft."
        );

        return;

    }


    /* =====================================================
       CURRENT USER
    ===================================================== */

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
            "Auth error:",
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


    console.log(
        "Logged in:",
        currentAdmin.email
    );


    /* =====================================================
       VERIFY ADMIN
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
            "Admin check error:",
            adminError
        );

    }


    if (
        !adminRow
    ) {

        console.error(
            "Current user is not an administrator."
        );


        window.location.href =
            "account.html";

        return;

    }


    setText(
        [
            "processorAdminEmail",
            "adminEmail"
        ],
        currentAdmin.email ||
        "ADMIN"
    );


    /* =====================================================
       LOAD
    ===================================================== */

    await loadProcessorScans();


    /* =====================================================
       AUTO REFRESH

       Do not create several timers.
    ===================================================== */

    if (
        refreshTimer
    ) {

        clearInterval(
            refreshTimer
        );

    }


    refreshTimer =
        window.setInterval(

            () => {

                loadProcessorScans()
                    .catch(
                        error => {

                            console.error(
                                "Automatic scan refresh failed:",
                                error
                            );

                        }
                    );

            },

            5000

        );

}



/* =========================================================
   LOAD SCANS
========================================================= */

async function loadProcessorScans() {

    console.log(
        "Loading ear scans..."
    );


    /*
     * Do NOT request processor_accelerator here.
     *
     * This keeps this page compatible even if that
     * database column has not been added yet.
     */

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
            "LOAD SCANS ERROR:",
            error
        );


        showProcessorMessage(

            `Unable to load scans: ${
                error.message
            }`

        );


        const container =
            getScanContainer();


        if (
            container
        ) {

            container.innerHTML = `

                <div class="scan-error">

                    Unable to load ear scans.

                    <br><br>

                    ${escapeHTML(
                        error.message
                    )}

                </div>

            `;

        }


        return;

    }


    allScans =
        data ||
        [];


    console.log(
        "Scans loaded:",
        allScans.length
    );


    renderProcessorStats();

    renderProcessorScans();

}



/* =========================================================
   FIND SCAN CONTAINER

   Supports old + new HTML
========================================================= */

function getScanContainer() {

    return getFirstElement(

        "processorScanList",

        "scanList",

        "adminScanList"

    );

}



/* =========================================================
   STATS
========================================================= */

function renderProcessorStats() {

    const countStatus =
        status =>
            allScans.filter(
                scan =>
                    scan.status ===
                    status
            ).length;


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
   STATUS FILTER

   Supports old + new HTML
========================================================= */

function getStatusFilter() {

    return getFirstElement(

        "processorStatusFilter",

        "scanStatusFilter"

    );

}



function getFilteredScans() {

    const filter =
        getStatusFilter();


    if (
        !filter ||
        !filter.value
    ) {

        return allScans;

    }


    return allScans.filter(
        scan =>
            scan.status ===
            filter.value
    );

}



/* =========================================================
   RENDER
========================================================= */

function renderProcessorScans() {

    const container =
        getScanContainer();


    if (
        !container
    ) {

        console.error(
            "No scan list container found."
        );


        showProcessorMessage(
            "scan-admin.html and scan-admin.js do not contain matching scan-list IDs."
        );

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

            <div class="loading-card">

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
   CARD
========================================================= */

function createScanCard(
    scan
) {

    const card =
        document.createElement(
            "article"
        );


    /*
     * Include both class names so either version
     * of your CSS can style it.
     */

    card.className =
        "processor-scan-card scan-card";


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

        <div class="scan-card-header scan-card-top">

            <div>

                <span class="card-label">
                    EAR SCAN
                </span>

                <h3>
                    ${shortID(
                        scan.id
                    )}
                </h3>

                <div class="scan-full-id scan-id">

                    ${escapeHTML(
                        scan.id
                    )}

                </div>

            </div>


            <span
                class="
                    status-badge
                    scan-status
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


        <div class="scan-data-grid scan-info">

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
                    CREATED
                </span>

                <strong>

                    ${formatDate(
                        scan.created_at
                    )}

                </strong>

            </article>

        </div>


        <div class="scan-progress progress-area">

            <div class="progress-heading progress-top">

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
                    class="progress-fill progress-bar"
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

                    ${escapeHTML(
                        scan.error_message
                    )}

                </div>

            `

            : ""
        }


        <div class="scan-meta">

            <span>

                UPDATED

                ${formatDate(
                    scan.updated_at
                )}

            </span>

        </div>


        <div class="scan-card-actions scan-actions">

            ${getActionHTML(
                scan
            )}

        </div>

    `;


    /* =====================================================
       PROCESS
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
   BUTTONS
========================================================= */

function getActionHTML(
    scan
) {

    let html =
        "";


    /* -----------------------------------------------------
       UPLOADED
    ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       FAILED
    ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       QUEUED
    ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       PROCESSING
    ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       COMPLETE
    ----------------------------------------------------- */

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
                    class="outline-button secondary"
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
                    class="outline-button secondary"
                    data-right-stl
                >
                    RIGHT STL
                </button>

            `;

        }


        html += `

            <button
                type="button"
                class="outline-button secondary"
                data-process
            >
                REPROCESS
            </button>

        `;

    }


    /* -----------------------------------------------------
       CAPTURING
    ----------------------------------------------------- */

    else if (
        scan.status ===
        "capturing"
    ) {

        html += `

            <button
                type="button"
                class="outline-button secondary"
                disabled
            >
                CUSTOMER CAPTURING
            </button>

        `;

    }


    /* -----------------------------------------------------
       DELETE

       Allow deletion for everything except active processing.
    ----------------------------------------------------- */

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
   QUEUE / RETRY / REPROCESS
========================================================= */

async function queueScan(
    scanID
) {

    showProcessorMessage(
        "Adding scan to processing queue..."
    );


    console.log(
        "Queuing scan:",
        scanID
    );


    const {
        data,
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
            )
            .select();


    if (
        error
    ) {

        console.error(
            "QUEUE ERROR:",
            error
        );


        showProcessorMessage(
            `Unable to queue scan: ${
                error.message
            }`
        );

        return;

    }


    console.log(
        "Queue response:",
        data
    );


    if (
        !data ||
        data.length ===
        0
    ) {

        showProcessorMessage(
            "The scan was not updated. Check the admin UPDATE RLS policy."
        );

        return;

    }


    showProcessorMessage(
        "Scan queued. The local processor will pick it up shortly."
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
            "No STL is available."
        );

        return;

    }


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
            "STL ERROR:",
            error
        );


        showProcessorMessage(
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
            "A scan cannot be deleted while it is actively processing."
        );

        return;

    }


    pendingDeleteScan =
        scan;


    /*
     * New modal version.
     */

    const modal =
        document.getElementById(
            "deleteScanModal"
        );


    if (
        modal
    ) {

        setText(
            "deleteScanId",
            scan.id
        );


        modal.classList.add(
            "open"
        );


        modal.setAttribute(
            "aria-hidden",
            "false"
        );


        return;

    }


    /*
     * Your older scan-admin HTML might not yet
     * contain the delete modal.
     *
     * Fall back to native confirmation so DELETE
     * still works.
     */

    const confirmed =
        window.confirm(

            "Permanently delete this ear scan?\n\n" +

            "This deletes the uploaded photographs, generated STL files and database record.\n\n" +

            "This cannot be undone."

        );


    if (
        confirmed
    ) {

        deleteSelectedScan();

    }

}



/* =========================================================
   CLOSE MODAL
========================================================= */

function closeDeleteScanModal() {

    const modal =
        document.getElementById(
            "deleteScanModal"
        );


    if (
        modal
    ) {

        modal.classList.remove(
            "open"
        );


        modal.setAttribute(
            "aria-hidden",
            "true"
        );

    }


    pendingDeleteScan =
        null;

}



/* =========================================================
   DELETE STORAGE RECURSIVELY
========================================================= */

async function collectStorageFiles(
    bucket,
    folder,
    output
) {

    let offset =
        0;


    const limit =
        100;


    while (
        true
    ) {

        console.log(
            "Listing storage:",
            folder,
            "offset:",
            offset
        );


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
                                "asc"

                        }

                    }
                );


        if (
            error
        ) {

            throw new Error(
                `Unable to list storage folder ${folder}: ${error.message}`
            );

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
             * Folder entries normally have no id.
             */

            if (
                !entry.id
            ) {

                await collectStorageFiles(

                    bucket,

                    path,

                    output

                );

            }

            else {

                output.push(
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



/* =========================================================
   DELETE DIRECTLY THROUGH RLS
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


    if (
        !scan.user_id
    ) {

        throw new Error(
            "Scan owner is missing."
        );

    }


    const scanID =
        scan.id;


    const userID =
        scan.user_id;


    const rootPath =
        `${userID}/${scanID}`;


    const bucket =
        processorDB
            .storage
            .from(
                STORAGE_BUCKET
            );


    const files =
        [];


    /* =====================================================
       LIST ALL FILES
    ===================================================== */

    await collectStorageFiles(

        bucket,

        rootPath,

        files

    );


    console.log(
        `Found ${files.length} storage files for deletion.`
    );


    /* =====================================================
       DELETE FILES
    ===================================================== */

    const batchSize =
        100;


    for (
        let index = 0;

        index <
        files.length;

        index +=
        batchSize
    ) {

        const batch =
            files.slice(

                index,

                index +
                batchSize

            );


        console.log(
            "Deleting storage batch:",
            batch.length
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

            throw new Error(
                `Storage delete failed: ${error.message}`
            );

        }

    }


    /* =====================================================
       DELETE DATABASE ROW
    ===================================================== */

    const {
        data: deletedRows,
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
            )
            .select();


    if (
        deleteError
    ) {

        throw new Error(
            `Database delete failed: ${deleteError.message}`
        );

    }


    /*
     * Important diagnostic:
     *
     * Supabase can return no error but delete zero rows
     * when RLS prevents the operation.
     */

    if (
        !deletedRows ||
        deletedRows.length ===
        0
    ) {

        throw new Error(
            "No database row was deleted. Check the admin DELETE RLS policy."
        );

    }


    return {

        success:
            true,

        filesDeleted:
            files.length,

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


    const scan =
        pendingDeleteScan;


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


    showProcessorMessage(
        "Deleting scan and storage files..."
    );


    try {

        const result =
            await deleteScanDirectly(
                scan
            );


        /*
         * Clear only after deletion succeeds.
         */

        const modal =
            document.getElementById(
                "deleteScanModal"
            );


        if (
            modal
        ) {

            modal.classList.remove(
                "open"
            );


            modal.setAttribute(
                "aria-hidden",
                "true"
            );

        }


        pendingDeleteScan =
            null;


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
            "DELETE SCAN ERROR:",
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
        getFirstElement(

            "processorMessage",

            "scanMessage",

            "adminMessage"

        );


    if (
        element
    ) {

        element.textContent =
            message ||
            "";

    }


    console.log(
        "PROCESSOR:",
        message
    );

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
   DATE
========================================================= */

function formatDate(
    value
) {

    if (
        !value
    ) {

        return "—";

    }


    const date =
        new Date(
            value
        );


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return String(
            value
        );

    }


    return date.toLocaleString(
        "en-GB"
    );

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
   REFRESH BUTTON

   Supports both versions.
========================================================= */

const refreshButton =
    getFirstElement(

        "processorRefreshButton",

        "refreshButton",

        "refreshScansButton"

    );


if (
    refreshButton
) {

    refreshButton.addEventListener(

        "click",

        async () => {

            showProcessorMessage(
                "Refreshing scans..."
            );


            await loadProcessorScans();


            showProcessorMessage(
                ""
            );

        }

    );

}



/* =========================================================
   FILTER
========================================================= */

const statusFilter =
    getStatusFilter();


if (
    statusFilter
) {

    statusFilter.addEventListener(
        "change",
        renderProcessorScans
    );

}



/* =========================================================
   DELETE MODAL EVENTS
========================================================= */

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



/* =========================================================
   ESCAPE
========================================================= */

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
   PAGE CLEANUP
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

initialiseProcessor()
    .catch(
        error => {

            console.error(
                "PROCESSOR STARTUP ERROR:",
                error
            );


            showProcessorMessage(
                `Processor page error: ${
                    error.message
                }`
            );

        }
    );