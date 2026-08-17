import SwiftUI


struct ScanView: View {


    @EnvironmentObject
    private var manager:
        ScanManager


    @StateObject
    private var collector =
        MeshCollector()


    @State
    private var scanning =
        false


    @State
    private var processing =
        false


    @State
    private var errorText:
        String?



    var body: some View {


        ZStack {


            ARScannerView(
                collector:
                    collector,
                scanning:
                    $scanning
            )
            .ignoresSafeArea()



            VStack {


                topPanel


                Spacer()


                earGuide


                Spacer()


                controls


            }
            .padding()


        }
        .alert(
            "Scan Error",
            isPresented:
                Binding(
                    get: {
                        errorText != nil
                    },
                    set: { _ in
                        errorText = nil
                    }
                )
        ) {

            Button(
                "OK"
            ) {}

        } message: {

            Text(
                errorText ?? ""
            )

        }


    }



    private var topPanel:
        some View {


        HStack {


            VStack(
                alignment:
                    .leading
            ) {


                Text(
                    "HAMMER CRAFT"
                )
                .font(
                    .caption.bold()
                )


                Text(
                    manager.side ==
                        .left
                    ? "LEFT EAR"
                    : "RIGHT EAR"
                )
                .font(
                    .title2.bold()
                )


            }


            Spacer()


            Circle()
                .fill(
                    scanning
                    ? Color.red
                    : Color.white
                )
                .frame(
                    width: 10,
                    height: 10
                )


        }
        .padding()
        .background(
            .ultraThinMaterial
        )
        .clipShape(
            RoundedRectangle(
                cornerRadius: 18
            )
        )


    }



    private var earGuide:
        some View {


        RoundedRectangle(
            cornerRadius: 100
        )
        .stroke(
            Color.orange,
            lineWidth: 3
        )
        .frame(
            width: 220,
            height: 320
        )
        .overlay {


            VStack(
                spacing: 8
            ) {


                Text(
                    scanning
                    ? "MOVE SLOWLY"
                    : "POSITION EAR"
                )
                .font(
                    .caption.bold()
                )


                Text(
                    "\(collector.meshCount) mesh regions"
                )
                .font(
                    .caption2
                )


            }


        }


    }



    private var controls:
        some View {


        VStack(
            spacing: 15
        ) {


            Text(
                scanning
                ? "Move slowly around the ear while keeping it inside the guide."
                : "Keep the complete ear inside the guide before starting."
            )
            .font(.footnote)
            .multilineTextAlignment(
                .center
            )
            .padding()
            .background(
                .ultraThinMaterial
            )
            .clipShape(
                RoundedRectangle(
                    cornerRadius: 14
                )
            )



            if manager
                .uploadComplete {


                Button {


                    manager
                        .returnToWebsite()


                } label: {


                    Text(
                        "RETURN TO WEBSITE"
                    )
                    .frame(
                        maxWidth:
                            .infinity
                    )


                }
                .buttonStyle(
                    .borderedProminent
                )


            }


            else if processing {


                ProgressView(
                    manager.status
                )
                .padding()


            }


            else {


                Button {


                    if scanning {


                        finish()


                    }


                    else {


                        collector.clear()


                        scanning =
                            true


                    }


                } label: {


                    Text(
                        scanning
                        ? "FINISH SCAN"
                        : "START SCAN"
                    )
                    .frame(
                        maxWidth:
                            .infinity
                    )


                }
                .buttonStyle(
                    .borderedProminent
                )


            }


        }


    }



    private func finish() {


        scanning =
            false


        processing =
            true


        Task {


            do {


                let mesh =
                    try collector
                        .combinedMesh()


                let filename =
                    manager.side ==
                        .left
                    ? "left-ear.stl"
                    : "right-ear.stl"


                let file =
                    try STLExporter
                        .export(
                            mesh:
                                mesh,
                            filename:
                                filename
                        )


                try await manager
                    .upload(
                        file:
                            file
                    )


            }


            catch {


                errorText =
                    error
                        .localizedDescription


            }


            processing =
                false


        }


    }


}