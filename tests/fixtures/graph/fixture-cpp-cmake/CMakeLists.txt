cmake_minimum_required(VERSION 3.16)
project(DemoApp CXX)

add_library(core src/service.cpp)
target_include_directories(core PUBLIC include)

add_executable(app src/main.cpp)
target_link_libraries(app PRIVATE core)