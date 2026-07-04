import cv2
import tkinter as tk
from PIL import Image, ImageTk, ImageDraw

class CircularCam:
    def __init__(self):
        self.root = tk.Tk()
        
        # Remove a barra de título e bordas padrão do Windows
        self.root.overrideredirect(True)
        # Mantém a bolha sempre por cima de qualquer outra janela
        self.root.wm_attributes("-topmost", True)
        
        # Define a cor que o Windows vai tornar transparente e invisível
        self.trans_color = "#abcdef"
        self.root.config(bg=self.trans_color)
        self.root.wm_attributes("-transparentcolor", self.trans_color)
        
        # Diâmetro da bolha circular (250x250 pixels)
        self.size = 250
        self.root.geometry(f"{self.size}x{self.size}+50+50")
        
        # Cria a área de desenho do Tkinter
        self.canvas = tk.Canvas(self.root, width=self.size, height=self.size, bg=self.trans_color, highlightthickness=0)
        self.canvas.pack()
        
        # Inicia a captura da webcam
        self.cap = cv2.VideoCapture(0)
        
        # Eventos para arrastar a bolha com o mouse
        self.canvas.bind("<Button-1>", self.start_drag)
        self.canvas.bind("<B1-Motion>", self.drag)
        
        # Clique duplo para fechar a câmera
        self.canvas.bind("<Double-Button-1>", lambda e: self.close())
        
        self.update_frame()
        self.root.mainloop()

    def start_drag(self, event):
        self.x = event.x
        self.y = event.y

    def drag(self, event):
        deltax = event.x - self.x
        deltay = event.y - self.y
        x = self.root.winfo_x() + deltax
        y = self.root.winfo_y() + deltay
        self.root.geometry(f"+{x}+{y}")

    def update_frame(self):
        ret, frame = self.cap.read()
        if ret:
            # Espelha o vídeo horizontalmente
            frame = cv2.flip(frame, 1)
            frame = cv2.resize(frame, (self.size, self.size))
            cv2image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGBA)
            
            # Imagem do feed da câmera
            img = Image.fromarray(cv2image)
            
            # Cria a máscara circular (corta a imagem em formato redondo)
            mask = Image.new("L", (self.size, self.size), 0)
            draw_mask = ImageDraw.Draw(mask)
            # Desenha um círculo preenchido de branco para a máscara (deixando uma pequena margem interna para a borda)
            margin = 3
            draw_mask.ellipse((margin, margin, self.size - margin, self.size - margin), fill=255)
            
            # Recorta a câmera no círculo
            circular_img = Image.new("RGBA", (self.size, self.size), (0,0,0,0))
            circular_img.paste(img, (0,0), mask=mask)
            
            # Cria a imagem de fundo com a cor transparente
            bg = Image.new("RGBA", (self.size, self.size), self.trans_color)
            
            # Desenha a borda circular violeta elegante
            draw_bg = ImageDraw.Draw(bg)
            draw_bg.ellipse((1, 1, self.size - 1, self.size - 1), outline="#8b5cf6", width=4)
            
            # Cola a imagem recortada por cima do fundo com a borda
            bg.paste(circular_img, (0,0), mask=mask)
            
            # Converte e desenha na tela
            imgtk = ImageTk.PhotoImage(image=bg)
            self.canvas.imgtk = imgtk
            self.canvas.create_image(0, 0, anchor="nw", image=imgtk)
            
        self.root.after(15, self.update_frame)

    def close(self):
        self.cap.release()
        self.root.destroy()

if __name__ == "__main__":
    CircularCam()
