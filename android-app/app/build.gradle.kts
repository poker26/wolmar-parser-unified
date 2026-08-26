import java.net.URI
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val apiBaseUrl = providers.gradleProperty("NUMISMAT_API_BASE_URL")
    .orElse("https://coins.begemot26.ru/")
    .map(String::trim)

val parsedApiBaseUrl = URI(apiBaseUrl.get())
require(
    parsedApiBaseUrl.scheme == "https" &&
        parsedApiBaseUrl.host != null &&
        parsedApiBaseUrl.userInfo == null &&
        parsedApiBaseUrl.query == null &&
        parsedApiBaseUrl.fragment == null
) {
    "NUMISMAT_API_BASE_URL must be an HTTPS origin without credentials, query or fragment"
}

val releaseSigningFile = rootProject.file("signing/keystore.properties")
val releaseSigning = Properties().apply {
    if (releaseSigningFile.isFile) {
        releaseSigningFile.inputStream().use { load(it) }
    }
}
val releaseSigningKeys = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
val releaseSigningReady = releaseSigningFile.isFile &&
    releaseSigningKeys.all { !releaseSigning.getProperty(it).isNullOrBlank() }

android {
    namespace = "ru.begemot26.numismat"
    compileSdk = 35

    defaultConfig {
        applicationId = "ru.begemot26.numismat"
        minSdk = 26
        targetSdk = 35
        versionCode = 6
        versionName = "0.6.0"
        buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrl.get()}\"")
    }

    signingConfigs {
        create("release") {
            if (releaseSigningReady) {
                storeFile = releaseSigningFile.parentFile.resolve(
                    releaseSigning.getProperty("storeFile"),
                )
                storePassword = releaseSigning.getProperty("storePassword")
                keyAlias = releaseSigning.getProperty("keyAlias")
                keyPassword = releaseSigning.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

val validateReleaseSigning by tasks.registering {
    group = "verification"
    description = "Fails release packaging when the private signing configuration is absent or incomplete."
    doLast {
        check(releaseSigningReady) {
            "Release signing is not configured. Run scripts/create-release-keystore.ps1 first."
        }
        val configuredStore = releaseSigningFile.parentFile.resolve(
            releaseSigning.getProperty("storeFile"),
        )
        check(configuredStore.isFile) {
            "Release keystore does not exist: $configuredStore"
        }
    }
}

tasks.matching {
    it.name == "assembleRelease" ||
        it.name == "bundleRelease" ||
        it.name.startsWith("packageRelease")
}.configureEach {
    dependsOn(validateReleaseSigning)
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("io.coil-kt:coil-compose:2.7.0")

    testImplementation("junit:junit:4.13.2")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
