import SwiftUI

@main
struct NumiIOSApp: App {
    @UIApplicationDelegateAdaptor(NumiNotificationDelegate.self) var notificationDelegate
    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-numi-waiting-preview") {
                RecognitionWaitingFixture()
            } else {
                ContentView()
            }
            #else
            ContentView()
            #endif
        }
    }
}
