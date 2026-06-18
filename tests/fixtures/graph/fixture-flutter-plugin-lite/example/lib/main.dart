import 'package:flutter/material.dart';
import 'package:my_plugin/my_plugin.dart';

void main() {
  runApp(const ExampleApp());
}

class ExampleApp extends StatelessWidget {
  const ExampleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(home: Scaffold(body: Text(MyPlugin().getPlatformVersion().toString())));
  }
}