cmake_minimum_required(VERSION 3.13)
project(nautilus-renderer)

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

if(WIN32)
  get_target_property(NAUTILUS_LOCATION Nautilus::Core LOCATION)
  if(NAUTILUS_LOCATION)
    get_filename_component(NAUTILUS_LIBRARY_PATH "${NAUTILUS_LOCATION}" PATH)
    set(PATH_EXT "${NAUTILUS_LIBRARY_PATH}")
  endif()
  if(TARGET Qt5::Core)
    get_target_property(QT_LOCATION Qt5::Core LOCATION)
    if(QT_LOCATION)
      get_filename_component(QT_LIBRARY_PATH "${QT_LOCATION}" PATH)
      list(APPEND PATH_EXT "${QT_LIBRARY_PATH}")
      get_filename_component(QT_PLUGIN_PATH "${QT_LIBRARY_PATH}/../plugins" ABSOLUTE)
    endif()
  endif()
  set(RUNENV "PATH=${PATH_EXT};%PATH%")
  if(QT_PLUGIN_PATH)
    set(RUNENV "${RUNENV}\nQT_PLUGIN_PATH=${QT_PLUGIN_PATH}")
  endif()
  set_target_properties(${PROJECT_NAME} PROPERTIES VS_DEBUGGER_ENVIRONMENT "${RUNENV}")
endif()
