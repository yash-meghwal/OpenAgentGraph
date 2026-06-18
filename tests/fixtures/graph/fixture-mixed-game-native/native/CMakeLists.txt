cmake_minimum_required(VERSION 3.16)
project(DemoNative CXX)

add_library(engine src/engine.cpp)
target_include_directories(engine PUBLIC include)