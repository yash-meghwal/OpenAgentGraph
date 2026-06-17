package com.example

class Greeter {
    fun greet(name: String): String {
        return formatGreeting(name)
    }
}

fun formatGreeting(name: String): String {
    return "Hello, $name"
}