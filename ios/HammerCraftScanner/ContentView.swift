import SwiftUI
import ARKit


struct ContentView: View {


    @EnvironmentObject
    private var manager:
        ScanManager


    var body: some View {


        Group {


            if !ARWorldTrackingConfiguration
                .supportsSceneReconstruction(
                    .mesh
                ) {


                unsupportedView


            }


            else if manager
                .ready {


                ScanView()


            }


            else {


                waitingView


            }


        }


    }



    private var waitingView: some View {


        VStack(
            spacing: 25
        ) {


            Spacer()


            Text(
                "HAMMER CRAFT"
            )
            .font(
                .caption.bold()
            )
            .tracking(4)


            Text(
                "Ear Scanner"
            )
            .font(
                .system(
                    size: 45,
                    weight: .semibold
                )
            )


            Text(
                "Start your scan from the Hammer Craft website."
            )
            .multilineTextAlignment(
                .center
            )
            .foregroundStyle(
                .secondary
            )


            Spacer()


            Text(
                "BRISTOL / UK"
            )
            .font(.caption2)


        }
        .padding()


    }



    private var unsupportedView:
        some View {


        VStack(
            spacing: 20
        ) {


            Text(
                "LiDAR unavailable"
            )
            .font(
                .largeTitle.bold()
            )


            Text(
                "This device does not support the LiDAR mesh reconstruction required by this Hammer Craft scanner."
            )
            .multilineTextAlignment(
                .center
            )
            .foregroundStyle(
                .secondary
            )


        }
        .padding(30)


    }


}