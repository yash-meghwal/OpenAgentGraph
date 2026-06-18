import 'package:flutter/material.dart';
import 'package:demo_app/services/api_service.dart';
import 'package:demo_app/widgets/home_screen.dart';

void main() {
  runApp(const DemoApp());
}

class DemoApp extends StatelessWidget {
  const DemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(home: HomeScreen(apiService: ApiService()));
  }
}