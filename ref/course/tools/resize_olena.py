from PIL import Image
import os

def resize_image(input_path, output_folder, sizes):
    if not os.path.exists(input_path):
        print(f"File not found: {input_path}")
        return

    filename = os.path.basename(input_path)
    name, ext = os.path.splitext(filename)

    with Image.open(input_path) as img:
        # Побудуємо оригінальне співвідношення сторін
        original_width, original_height = img.size
        ratio = original_height / original_width

        for size in sizes:
            new_width = size
            new_height = int(size * ratio)
            
            resized_img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
            output_path = os.path.join(output_folder, f"{name}-{size}.webp")
            resized_img.save(output_path, "WEBP", quality=85)
            print(f"Saved: {output_path}")

if __name__ == "__main__":
    # Використовуємо абсолютні шляхи
    current_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(current_dir, ".."))
    
    input_file = os.path.join(project_root, "assets", "images", "olena.webp")
    output_dir = os.path.join(project_root, "assets", "images")
    target_sizes = [360, 720, 1080]
    
    print(f"Input: {input_file}")
    print(f"Output dir: {output_dir}")
    
    resize_image(input_file, output_dir, target_sizes)
