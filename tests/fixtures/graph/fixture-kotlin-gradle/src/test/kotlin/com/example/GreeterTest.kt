package com.example

import org.junit.jupiter.api.Test

class GreeterTest {
    @Test
    fun greets() {
        Greeter().greet("world")
        formatGreeting("fixture")
    }
}