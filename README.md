# spatial-interpolation-dht22-webgis

This project integrates IoT, GIS, Spatial Interpolation, and WebGIS to monitor and visualize temperature and humidity variations across the NIT Warangal campus.

A network of DHT22 sensors connected to STM32 Nucleo-L476RG microcontrollers was deployed at multiple locations to collect geo-referenced environmental data. The observations were processed and interpolated using Inverse Distance Weighting (IDW) to generate continuous temperature and humidity surface maps, which were published through an interactive WebGIS platform.
