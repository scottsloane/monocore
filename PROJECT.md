# MONOCORE

This is a Flux trainer. It will have the capability to train both image generation models as well as full models (based on a base model).

## Stack

1. Tauri (rust): Portable UI applcation
2. Nodejs (bun) backend
3. git (github): repository
4. remote GB10 (spark): training and generation machine
5. Various LLM models on vLLM (remote)

## ELT

You will be making an entire ETL pipeline. This will include the following:

1. Prune: minimum dimentional size
2. Dedupe: duplicate or similar images using pHash
3. Quality: rank based on a quality evaluation (using vLLM)
4. Subject: test images to ensure they contain the right subject/asthetic (using vLLM)
5. Crop: when appropriate crop the image to contain the subject
6. Captioning: create captions for input images (using vLLM)
7. Train: do the actual training
8. Test: test with generation

## Constraints/qualifiers

Ensure the following are true:

1. Project folder and settings: for each new project create a folder to track and hold all files
2. Do not modify the source folder: copy images to the project folder from the selected input folder
3. Training Base: allow the user to select from various base models: SDXL, Flux, Wan, etc.
4. Training Type: allow the user to select the type of training: subject, asthetic, person, face
5. Default Settings: based on the project options prefill all settings with best guess options
6. VRAM: Utilize as much available VRAM (~128GB) when possible/appropriate

## git

Commit and push changes at all "milestones"

## UI/UX

1. Dark Mode only
2. Make the UI look modern and sexy
3. Minimize options for ease of use (hide extra options under "advanced" gates)

## GB10

Use scripts and remote execution via ssh (ssh gb10) to set up, maintain, and run the remote GB10.

## Claude

1. compact and clear context often
2. minimize token usage
3. Do NOT modify files outside of this folder on local and folders in ~/ on the GB10

## documentation

1. Keep a README.md updated when reaching "milestones"
2. Use the ./docs folder to keep track of memories, architecture, decisions, etc.
3. Create and use an INSTALL.md file

## scripts

Use the ./scripts folder to store scripts that need to be used for installation or other scripts that may be reused