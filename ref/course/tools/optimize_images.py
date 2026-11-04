import os
from PIL import Image

def resize_image(input_path, output_folder, widths):
    filename = os.path.basename(input_path)
    name, ext = os.path.splitext(filename)
    
    try:
        with Image.open(input_path) as img:
            # Ensure we work with RGB if it's RGBA for webp compatibility in some cases
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGBA")
            else:
                img = img.convert("RGB")

            for width in widths:
                # Calculate height maintaining aspect ratio
                w_percent = (width / float(img.size[0]))
                h_size = int((float(img.size[1]) * float(w_percent)))
                
                # Resize
                resized_img = img.resize((width, h_size), Image.Resampling.LANCZOS)
                
                # Save as webp
                output_filename = f"{name}-{width}.webp"
                output_path = os.path.join(output_folder, output_filename)
                resized_img.save(output_path, "WEBP", quality=85)
                print(f"Created: {output_filename}")
                
    except Exception as e:
        print(f"Error processing {input_path}: {e}")

def main():
    images_dir = "assets/images"
    widths = [360, 720, 1080]
    
    # Supported extensions
    extensions = ('.jpg', '.jpeg', '.png', '.webp')
    
    # Get all images in the directory
    files = [f for f in os.listdir(images_dir) if f.lower().endswith(extensions)]
    
    # Filter out already resized images to avoid recursion or double processing
    # Resized images have patterns like '-360.webp'
    files_to_process = []
    for f in files:
        is_resized = False
        for w in widths:
            if f"-{w}.webp" in f:
                is_resized = True
                break
        if not is_resized:
            files_to_process.append(f)

    if not files_to_process:
        print("No new images to process.")
        return

    print(f"Found {len(files_to_process)} images to optimize.")
    
    for filename in files_to_process:
        input_path = os.path.join(images_dir, filename)
        resize_image(input_path, images_dir, widths)

if __name__ == "__main__":
    main()
