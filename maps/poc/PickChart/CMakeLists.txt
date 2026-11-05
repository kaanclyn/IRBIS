cmake_minimum_required(VERSION 3.13)
project(PickChart)

find_package(Qt5 5.15 REQUIRED COMPONENTS Core Gui)
find_package(Nautilus 1.10.2.4 EXACT QUIET REQUIRED COMPONENTS Qt Core Cairo)
nautilus_add_qt_library()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(${PROJECT_NAME} main.cpp)

target_link_libraries(${PROJECT_NAME}
  Nautilus::Qt
  Nautilus::Core
  Nautilus::Cairo
  Qt5::Core
  Qt5::Gui)

target_compile_definitions(${PROJECT_NAME} PRIVATE
  "EXAMPLE_NAME=\"${PROJECT_NAME}\"")
