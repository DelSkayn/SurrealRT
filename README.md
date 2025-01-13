# SurrealRT

The worlds first multi-model ray tracer!
Get real time results as pixel are streamed in from the database rendering your scenes!.

SurrealRT is a very simple ray tracer written just in SurrealQL, no javascript functions used. 
You define an image, load spheres and triangles for a scene and then call the `fn::trace()` function.
The pixels will then be created and updated with the final image.

Includes a simple html page to load some spheres and display the result.

# Disclaimer

Obviously not a real SurrealDB product, this was just made for fun.
