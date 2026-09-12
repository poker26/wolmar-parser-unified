package ru.begemot26.numismat.shared

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val NumiBackground = Color(0xFF101115)
private val NumiIvory = Color(0xFFF4EFE7)
private val NumiCopper = Color(0xFFE5904C)

@Composable
fun NumiRoot() {
    MaterialTheme {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(NumiBackground)
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = "N",
                color = NumiCopper,
                fontFamily = FontFamily.Serif,
                fontSize = 72.sp,
                fontWeight = FontWeight.Medium,
            )
            Text(
                text = "Нуми",
                color = NumiIvory,
                fontFamily = FontFamily.Serif,
                fontSize = 40.sp,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}
