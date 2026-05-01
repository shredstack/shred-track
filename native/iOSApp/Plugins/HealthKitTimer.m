#import <Capacitor/Capacitor.h>

// Obj-C bridge stub so the Capacitor runtime can discover the
// `HealthKitTimer` Swift plugin. Drop this file into ios/App/App/
// alongside HealthKitTimer.swift after `npx cap add ios`.

CAP_PLUGIN(HealthKitTimer, "HealthKitTimer",
    CAP_PLUGIN_METHOD(requestPermissions, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(startWorkout, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(pauseWorkout, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(resumeWorkout, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(endWorkout, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getDistanceMeters, CAPPluginReturnPromise);
)
