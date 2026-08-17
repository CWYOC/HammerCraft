import SwiftUI


@main
struct HammerCraftScannerApp: App {


    @StateObject
    private var manager =
        ScanManager()


    var body: some Scene {


        WindowGroup {


            ContentView()
                .environmentObject(
                    manager
                )
                .onOpenURL { url in

                    manager
                        .handleURL(
                            url
                        )

                }


        }


    }


}