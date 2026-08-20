/* =========================================================
   HAMMER CRAFT
   CUSTOMER ORDER PAGE
========================================================= */


const orderDB =
    window.hcSupabase;


let orderUser =
    null;


let currentOrder =
    null;



/* =========================================================
   INITIALISE
========================================================= */

async function initialiseOrder() {

    if (
        !orderDB
    ) {

        showError(
            "Supabase unavailable."
        );

        return;
    }


    const {
        data,
        error
    } =
        await orderDB
            .auth
            .getUser();


    if (
        error
    ) {

        console.error(
            error
        );

    }


    orderUser =
        data?.user ||
        null;


    if (
        !orderUser
    ) {

        window.location.href =
            `login.html?redirect=${
                encodeURIComponent(
                    window.location.href
                )
            }`;

        return;
    }


    const params =
        new URLSearchParams(
            window.location.search
        );


    const orderID =
        params.get(
            "hc_order"
        );


    if (
        !orderID
    ) {

        showError(
            "Order reference missing."
        );

        return;
    }


    await loadOrder(
        orderID
    );

}



/* =========================================================
   LOAD ORDER
========================================================= */

async function loadOrder(
    orderID
) {

    const {
        data: order,
        error
    } =
        await orderDB
            .from(
                "orders"
            )
            .select(`
                *,
                order_items (
                    *
                ),
                ear_scans (
                    id,
                    user_id,
                    order_id,
                    status,
                    left_stl_path,
                    right_stl_path,
                    error_message,
                    created_at,
                    updated_at
                )
            `)
            .eq(
                "id",
                orderID
            )
            .eq(
                "user_id",
                orderUser.id
            )
            .maybeSingle();


    if (
        error ||
        !order
    ) {

        console.error(
            error
        );


        showError(
            "Unable to load this order."
        );

        return;
    }


    currentOrder =
        order;


    renderOrder();


    renderEarScan();


    await loadFiles();

}



/* =========================================================
   RENDER ORDER
========================================================= */

function renderOrder() {

    document
        .getElementById(
            "orderLoading"
        )
        .hidden =
        true;


    document
        .getElementById(
            "orderContent"
        )
        .hidden =
        false;


    document
        .getElementById(
            "orderNumber"
        )
        .textContent =
        currentOrder.order_number;


    document
        .getElementById(
            "orderStatus"
        )
        .textContent =
        formatStatus(
            currentOrder.status
        );


    document
        .getElementById(
            "orderTotal"
        )
        .textContent =
        `£${Number(
            currentOrder.total
        ).toFixed(2)}`;


    document
        .getElementById(
            "paymentStatus"
        )
        .textContent =
        formatStatus(
            currentOrder.payment_status
        );


    document
        .getElementById(
            "createdDate"
        )
        .textContent =
        new Date(
            currentOrder.created_at
        )
        .toLocaleDateString(
            "en-GB"
        );


    const items =
        currentOrder.order_items ||
        [];


    document
        .getElementById(
            "orderItems"
        )
        .innerHTML =
        items
            .map(
                item => {

                    const tags =
                        [];


                    if (
                        item.custom_fit
                    ) {

                        tags.push(
                            "CUSTOM FIT"
                        );

                    }


                    if (
                        item.custom_tuning
                    ) {

                        tags.push(
                            "CUSTOM TUNING"
                        );

                    }


                    return `

                        <div class="order-item-row">

                            <h3>

                                ${escapeHTML(
                                    item.product_name
                                )}

                            </h3>


                            <p>

                                ${
                                    item.order_type ===
                                    "preorder"

                                    ? "PREORDER"

                                    : "STANDARD ORDER"
                                }

                                · Quantity ${item.quantity}

                                · £${Number(
                                    item.line_total
                                ).toFixed(2)}

                            </p>


                            ${
                                tags.length > 0

                                ? `

                                    <div class="order-item-tags">

                                        ${
                                            tags
                                                .map(
                                                    tag => `

                                                        <span>
                                                            ${tag}
                                                        </span>

                                                    `
                                                )
                                                .join("")
                                        }

                                    </div>

                                `

                                : ""
                            }

                        </div>

                    `;

                }
            )
            .join("");

}



/* =========================================================
   EAR SCAN
========================================================= */

function renderEarScan() {

    const section =
        document.getElementById(
            "earScanSection"
        );


    const content =
        document.getElementById(
            "earScanContent"
        );


    const badge =
        document.getElementById(
            "earScanStatusBadge"
        );


    const needsCustomFit =
        (
            currentOrder.order_items ||
            []
        )
        .some(
            item =>
                item.custom_fit ===
                true
        );


    /*
        No custom fit in this order.
    */

    if (
        !needsCustomFit
    ) {

        section.hidden =
            true;

        return;
    }


    section.hidden =
        false;


    /*
        Find latest scan for this order.
    */

    const scans =
        (
            currentOrder.ear_scans ||
            []
        )
        .slice()
        .sort(
            (
                a,
                b
            ) =>
                new Date(
                    b.created_at
                )
                -
                new Date(
                    a.created_at
                )
        );


    const scan =
        scans[0] ||
        null;


    /*
        No scan yet.
    */

    if (
        !scan
    ) {

        badge.textContent =
            "NOT SUBMITTED";


        content.innerHTML = `

            <div class="scan-card">

                <h3>
                    Ear scan required.
                </h3>


                <p>

                    This order includes a custom-fit
                    Hammer Craft build.

                    Complete a digital ear scan so we
                    can create the ear geometry required
                    for your custom shell.

                </p>


                <a
                    href="ear-scan.html?order=${
                        encodeURIComponent(
                            currentOrder.id
                        )
                    }"
                    class="start-scan-button"
                >
                    START EAR SCAN →
                </a>

            </div>

        `;


        return;
    }


    badge.textContent =
        formatStatus(
            scan.status
        );


    /*
        CAPTURING
    */

    if (
        scan.status ===
        "capturing"
    ) {

        content.innerHTML = `

            <div class="scan-card">

                <h3>
                    Scan started.
                </h3>


                <p>

                    Your ear scan has been created,
                    but image capture has not yet
                    been completed.

                </p>


                <a
                    href="ear-scan.html?order=${
                        encodeURIComponent(
                            currentOrder.id
                        )
                    }"
                    class="start-scan-button"
                >
                    CONTINUE EAR SCAN →
                </a>

            </div>

        `;


        return;
    }


    /*
        UPLOADED
    */

    if (
        scan.status ===
        "uploaded"
    ) {

        content.innerHTML = `

            <div class="scan-card">

                <h3>
                    Scan received.
                </h3>


                <p>

                    Your left and right ear images
                    have been uploaded successfully.

                    They are waiting for Hammer Craft
                    reconstruction processing.

                </p>


                ${scanMetaHTML(
                    scan
                )}

            </div>

        `;


        return;
    }


    /*
        PROCESSING
    */

    if (
        scan.status ===
        "processing"
    ) {

        content.innerHTML = `

            <div class="scan-card">

                <h3>
                    Reconstruction in progress.
                </h3>


                <p>

                    Hammer Craft is currently
                    reconstructing your ear geometry
                    and preparing the 3D models.

                </p>


                ${scanMetaHTML(
                    scan
                )}

            </div>

        `;


        return;
    }


    /*
        COMPLETE
    */

    if (
        scan.status ===
        "complete"
    ) {

        content.innerHTML = `

            <div class="scan-card">

                <h3>
                    Ear geometry complete.
                </h3>


                <p>

                    Your digital ear reconstruction
                    has completed successfully.

                    The resulting geometry is now
                    available to the Hammer Craft
                    design workflow.

                </p>


                ${scanMetaHTML(
                    scan
                )}

            </div>

        `;


        return;
    }


    /*
        FAILED
    */

    if (
        scan.status ===
        "failed"
    ) {

        content.innerHTML = `

            <div class="scan-card">

                <h3>
                    Scan needs attention.
                </h3>


                <p class="scan-error">

                    ${
                        escapeHTML(
                            scan.error_message ||
                            "The ear reconstruction could not be completed."
                        )
                    }

                </p>


                <p>

                    You can submit another scan.
                    The previous failed scan will
                    remain in the system for
                    troubleshooting.

                </p>


                <a
                    href="ear-scan.html?order=${
                        encodeURIComponent(
                            currentOrder.id
                        )
                    }"
                    class="start-scan-button"
                >
                    TRY EAR SCAN AGAIN →
                </a>

            </div>

        `;


        return;
    }


    content.innerHTML = `

        <div class="scan-card">

            <h3>
                Ear scan status
            </h3>

            <p>
                ${escapeHTML(
                    formatStatus(
                        scan.status
                    )
                )}
            </p>

        </div>

    `;

}



/* =========================================================
   SCAN META
========================================================= */

function scanMetaHTML(
    scan
) {

    return `

        <div class="scan-meta">

            <div>

                <span>
                    SCAN ID
                </span>

                <strong>
                    ${escapeHTML(
                        scan.id
                    )}
                </strong>

            </div>


            <div>

                <span>
                    LEFT EAR
                </span>

                <strong>

                    ${
                        scan.left_stl_path
                        ? "READY"
                        : "PENDING"
                    }

                </strong>

            </div>


            <div>

                <span>
                    RIGHT EAR
                </span>

                <strong>

                    ${
                        scan.right_stl_path
                        ? "READY"
                        : "PENDING"
                    }

                </strong>

            </div>

        </div>

    `;

}



/* =========================================================
   CUSTOMER FILE UPLOAD
========================================================= */

async function uploadFile(
    file
) {

    if (
        !file ||
        !currentOrder
    ) {

        return;
    }


    const maximumSize =
        25 *
        1024 *
        1024;


    if (
        file.size >
        maximumSize
    ) {

        showFileMessage(
            "Maximum file size is 25 MB."
        );

        return;
    }


    const safeName =
        file.name
            .replace(
                /[^a-zA-Z0-9._-]/g,
                "_"
            );


    const path =
        `${orderUser.id}/${currentOrder.id}/${crypto.randomUUID()}-${safeName}`;


    showFileMessage(
        "Uploading..."
    );


    const {
        error
    } =
        await orderDB
            .storage
            .from(
                "customer-files"
            )
            .upload(
                path,
                file,
                {
                    upsert:
                        false
                }
            );


    if (
        error
    ) {

        showFileMessage(
            error.message
        );

        return;
    }


    showFileMessage(
        "File uploaded."
    );


    document
        .getElementById(
            "customerFileInput"
        )
        .value =
        "";


    await loadFiles();

}



/* =========================================================
   LOAD FILES
========================================================= */

async function loadFiles() {

    const folder =
        `${orderUser.id}/${currentOrder.id}`;


    const {
        data,
        error
    } =
        await orderDB
            .storage
            .from(
                "customer-files"
            )
            .list(
                folder,
                {
                    limit:
                        100
                }
            );


    const container =
        document.getElementById(
            "customerFiles"
        );


    if (
        error
    ) {

        container.textContent =
            error.message;

        return;
    }


    if (
        !data ||
        data.length ===
        0
    ) {

        container.innerHTML = `

            <div class="file-row">

                <span class="file-name">
                    No files uploaded yet.
                </span>

            </div>

        `;

        return;
    }


    container.innerHTML =
        "";


    data.forEach(
        file => {

            const path =
                `${folder}/${file.name}`;


            const row =
                document.createElement(
                    "div"
                );


            row.className =
                "file-row";


            row.innerHTML = `

                <span class="file-name">

                    ${escapeHTML(
                        cleanDisplayFilename(
                            file.name
                        )
                    )}

                </span>


                <div class="file-actions">

                    <button
                        type="button"
                        data-open
                    >
                        OPEN
                    </button>


                    <button
                        type="button"
                        data-delete
                    >
                        DELETE
                    </button>

                </div>

            `;


            row
                .querySelector(
                    "[data-open]"
                )
                .addEventListener(
                    "click",
                    () =>
                        openFile(
                            path
                        )
                );


            row
                .querySelector(
                    "[data-delete]"
                )
                .addEventListener(
                    "click",
                    () =>
                        deleteFile(
                            path
                        )
                );


            container.appendChild(
                row
            );

        }
    );

}



/* =========================================================
   OPEN FILE
========================================================= */

async function openFile(
    path
) {

    const {
        data,
        error
    } =
        await orderDB
            .storage
            .from(
                "customer-files"
            )
            .createSignedUrl(
                path,
                600
            );


    if (
        error
    ) {

        showFileMessage(
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
   DELETE FILE
========================================================= */

async function deleteFile(
    path
) {

    if (
        !window.confirm(
            "Delete this file?"
        )
    ) {

        return;
    }


    const {
        error
    } =
        await orderDB
            .storage
            .from(
                "customer-files"
            )
            .remove([
                path
            ]);


    if (
        error
    ) {

        showFileMessage(
            error.message
        );

        return;
    }


    showFileMessage(
        "File deleted."
    );


    await loadFiles();

}



/* =========================================================
   HELPERS
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


function cleanDisplayFilename(
    filename
) {

    return filename.replace(
        /^[0-9a-f-]{36}-/,
        ""
    );

}


function showFileMessage(
    message
) {

    document
        .getElementById(
            "fileMessage"
        )
        .textContent =
        message ||
        "";

}


function showError(
    message
) {

    const loading =
        document.getElementById(
            "orderLoading"
        );


    loading.hidden =
        false;


    loading.textContent =
        message;

}


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
   FILE INPUT
========================================================= */

document
    .getElementById(
        "customerFileInput"
    )
    .addEventListener(
        "change",
        event => {

            const file =
                event.target
                    .files?.[0];


            if (
                file
            ) {

                uploadFile(
                    file
                );

            }

        }
    );



/* =========================================================
   START
========================================================= */

initialiseOrder();