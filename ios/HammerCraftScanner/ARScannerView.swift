import SwiftUI
import ARKit
import SceneKit


struct ARScannerView:
    UIViewRepresentable {


    @ObservedObject
    var collector:
        MeshCollector


    @Binding
    var scanning:
        Bool



    func makeCoordinator()
        -> Coordinator {


        Coordinator(
            collector:
                collector,
            scanning:
                scanning
        )


    }



    func makeUIView(
        context:
            Context
    ) -> ARSCNView {


        let view =
            ARSCNView(
                frame: .zero
            )


        view.session.delegate =
            context.coordinator


        view.automaticallyUpdatesLighting =
            true


        let configuration =
            ARWorldTrackingConfiguration()


        if ARWorldTrackingConfiguration
            .supportsSceneReconstruction(
                .mesh
            ) {


            configuration
                .sceneReconstruction =
                .mesh


        }


        if ARWorldTrackingConfiguration
            .supportsFrameSemantics(
                .sceneDepth
            ) {


            configuration
                .frameSemantics
                .insert(
                    .sceneDepth
                )


        }


        view.session.run(

            configuration,

            options: [
                .resetTracking,
                .removeExistingAnchors
            ]

        )


        return view


    }



    func updateUIView(
        _ uiView:
            ARSCNView,
        context:
            Context
    ) {


        context
            .coordinator
            .scanning =
            scanning


    }



    final class Coordinator:
        NSObject,
        ARSessionDelegate {


        let collector:
            MeshCollector


        var scanning:
            Bool


        init(
            collector:
                MeshCollector,
            scanning:
                Bool
        ) {


            self.collector =
                collector


            self.scanning =
                scanning


        }



        func session(
            _ session:
                ARSession,
            didUpdate anchors:
                [ARAnchor]
        ) {


            guard scanning
            else {

                return

            }


            for anchor in anchors {


                guard
                    let meshAnchor =
                        anchor
                        as?
                        ARMeshAnchor
                else {

                    continue

                }


                Task {
                    @MainActor in


                    collector
                        .update(
                            anchor:
                                meshAnchor
                        )


                }


            }


        }


    }


}