cmake_minimum_required(VERSION 3.13)
project(CheckDevLicense)

find_package(Nautilus 1.10.2.4 EXACT REQUIRED COMPONENTS Core)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(${PROJECT_NAME} main.cpp)
target_link_libraries(${PROJECT_NAME} Nautilus::Core)

if(WIN32)
  get_target_property(NAUTILUS_LOCATION Nautilus::Core LOCATION)
  if(NAUTILUS_LOCATION)
    get_filename_component(NAUTILUS_LIBRARY_PATH "${NAUTILUS_LOCATION}" PATH)
    set_target_properties(${PROJECT_NAME} PROPERTIES
      VS_DEBUGGER_ENVIRONMENT "PATH=${NAUTILUS_LIBRARY_PATH};%PATH%")
  endif()
endif()
