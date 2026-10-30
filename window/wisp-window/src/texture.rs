use std::io::Cursor;

use ddsfile::{D3DFormat, Dds, DxgiFormat};
use image::ImageFormat;
use texpresso::Format;

pub struct Image {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

pub fn decode(bytes: &[u8]) -> Result<Image, String> {
    match bytes {
        [b'B', b'L', b'P', b'1', ..] => blp(bytes),
        [b'D', b'D', b'S', b' ', ..] => dds(bytes),
        [0x89, b'P', b'N', b'G', ..] => raster(bytes, ImageFormat::Png),
        [0xFF, 0xD8, ..] => raster(bytes, ImageFormat::Jpeg),
        _ => raster(bytes, ImageFormat::Tga),
    }
}

fn raster(bytes: &[u8], format: ImageFormat) -> Result<Image, String> {
    let decoded = image::load_from_memory_with_format(bytes, format).map_err(|error| format!("{format:?} texture: {error}"))?;
    let rgba = decoded.into_rgba8();
    Ok(Image { width: rgba.width(), height: rgba.height(), rgba: rgba.into_raw() })
}

fn blp(bytes: &[u8]) -> Result<Image, String> {
    match header_word(bytes, 4) {
        Some(1) => blp_paletted(bytes),
        Some(0) => blp_jpeg(bytes),
        _ => Err("BLP texture has an unknown content type".to_string()),
    }
}

fn header_word(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn blp_jpeg(bytes: &[u8]) -> Result<Image, String> {
    let parsed = image_blp::parser::load_blp_from_buf(bytes).map_err(|error| format!("BLP texture: {error}"))?;
    let top = image_blp::convert::blp_to_image(&parsed, 0).map_err(|error| format!("BLP texture: {error}"))?.into_rgba8();
    Ok(Image { width: top.width(), height: top.height(), rgba: top.into_raw() })
}

fn blp_paletted(bytes: &[u8]) -> Result<Image, String> {
    let truncated = || "BLP texture ends before its top image does".to_string();
    let word = |at| header_word(bytes, at).ok_or_else(truncated);
    let (alpha_bits, width, height) = (word(8)?, word(12)?, word(16)?);
    let (offset, size) = (word(28)? as usize, word(92)?);
    if size == 0 || !matches!(alpha_bits, 0 | 1 | 4 | 8) {
        return Err("BLP texture has no top image or an unsupported alpha depth".to_string());
    }
    let pixels = width as usize * height as usize;
    let palette = bytes.get(156..156 + 1024).ok_or_else(truncated)?;
    let indices = bytes.get(offset..offset + pixels).ok_or_else(truncated)?;
    let alpha = bytes.get(offset + pixels..offset + pixels + (pixels * alpha_bits as usize).div_ceil(8)).ok_or_else(truncated)?;
    let top = (1u32 << alpha_bits) - 1;
    let mut rgba = Vec::with_capacity(pixels * 4);
    for (index, &entry) in indices.iter().enumerate() {
        let color = &palette[entry as usize * 4..];
        let opacity = if alpha_bits == 0 {
            255
        } else {
            let per_byte = 8 / alpha_bits as usize;
            let coverage = u32::from(alpha[index / per_byte] >> (alpha_bits as usize * (index % per_byte))) & top;
            (coverage * 255 / top) as u8
        };
        rgba.extend([color[2], color[1], color[0], opacity]);
    }
    Ok(Image { width, height, rgba })
}

fn dds(bytes: &[u8]) -> Result<Image, String> {
    let file = Dds::read(Cursor::new(bytes)).map_err(|error| format!("DDS texture: {error}"))?;
    let (width, height) = (file.get_width(), file.get_height());
    let data = file.get_data(0).map_err(|error| format!("DDS texture: {error}"))?;
    let pixels = width as usize * height as usize;
    let rgba = match (file.get_d3d_format(), file.get_dxgi_format()) {
        (Some(D3DFormat::DXT1), _) | (_, Some(DxgiFormat::BC1_UNorm | DxgiFormat::BC1_UNorm_sRGB)) => block(Format::Bc1, data, width, height)?,
        (Some(D3DFormat::DXT3), _) | (_, Some(DxgiFormat::BC2_UNorm | DxgiFormat::BC2_UNorm_sRGB)) => block(Format::Bc2, data, width, height)?,
        (Some(D3DFormat::DXT5), _) | (_, Some(DxgiFormat::BC3_UNorm | DxgiFormat::BC3_UNorm_sRGB)) => block(Format::Bc3, data, width, height)?,
        (Some(D3DFormat::A8B8G8R8), _) | (_, Some(DxgiFormat::R8G8B8A8_UNorm | DxgiFormat::R8G8B8A8_UNorm_sRGB)) => packed(data, pixels, |p| [p[0], p[1], p[2], p[3]])?,
        (Some(D3DFormat::A8R8G8B8), _) | (_, Some(DxgiFormat::B8G8R8A8_UNorm | DxgiFormat::B8G8R8A8_UNorm_sRGB)) => packed(data, pixels, |p| [p[2], p[1], p[0], p[3]])?,
        (Some(D3DFormat::X8R8G8B8), _) => packed(data, pixels, |p| [p[2], p[1], p[0], 255])?,
        (d3d, dxgi) => return Err(format!("DDS texture format {d3d:?} {dxgi:?} is not supported")),
    };
    Ok(Image { width, height, rgba })
}

fn block(format: Format, data: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let (columns, rows) = (width.div_ceil(4) as usize, height.div_ceil(4) as usize);
    if data.len() < columns * rows * format.block_size() {
        return Err("DDS texture ends before its top image does".to_string());
    }
    let mut rgba = vec![0; width as usize * height as usize * 4];
    format.decompress(data, width as usize, height as usize, &mut rgba);
    Ok(rgba)
}

fn packed(data: &[u8], pixels: usize, order: impl Fn(&[u8]) -> [u8; 4]) -> Result<Vec<u8>, String> {
    let data = data.get(..pixels * 4).ok_or("DDS texture ends before its top image does")?;
    Ok(data.chunks_exact(4).flat_map(order).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::codecs::{jpeg::JpegEncoder, png::PngEncoder};
    use image::{ExtendedColorType, ImageEncoder};

    fn word(bytes: &mut [u8], at: usize, value: u32) {
        bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    #[test]
    fn png_decodes_to_straight_rgba() {
        let pixels = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 9, 8, 7, 255];
        let mut bytes = Vec::new();
        PngEncoder::new(&mut bytes).write_image(&pixels, 2, 2, ExtendedColorType::Rgba8).unwrap();
        let decoded = decode(&bytes).unwrap();
        assert_eq!((decoded.width, decoded.height, decoded.rgba), (2, 2, pixels.to_vec()));
    }

    #[test]
    fn jpeg_decodes_within_the_codec_tolerance() {
        let pixels: Vec<u8> = (0..8 * 8).flat_map(|_| [200, 100, 50]).collect();
        let mut bytes = Vec::new();
        JpegEncoder::new_with_quality(&mut bytes, 95).write_image(&pixels, 8, 8, ExtendedColorType::Rgb8).unwrap();
        let decoded = decode(&bytes).unwrap();
        assert_eq!((decoded.width, decoded.height), (8, 8));
        for pixel in decoded.rgba.chunks_exact(4) {
            assert!(pixel.iter().zip([200u8, 100, 50, 255]).all(|(got, want)| got.abs_diff(want) <= 3), "{pixel:?}");
        }
    }

    #[test]
    fn tga_decodes_bottom_up_and_run_length_files() {
        let mut plain = vec![0; 18];
        plain[2] = 2;
        plain[12] = 2;
        plain[14] = 2;
        plain[16] = 24;
        plain.extend([3, 2, 1, 6, 5, 4, 9, 8, 7, 12, 11, 10]);
        let decoded = decode(&plain).unwrap();
        assert_eq!(decoded.rgba, [7, 8, 9, 255, 10, 11, 12, 255, 1, 2, 3, 255, 4, 5, 6, 255]);

        let mut run = vec![0; 18];
        run[2] = 10;
        run[12] = 2;
        run[14] = 1;
        run[16] = 32;
        run[17] = 32;
        run.extend([0x81, 30, 20, 10, 128, 0x00, 1, 2, 3, 4]);
        let decoded = decode(&run).unwrap();
        assert_eq!(decoded.rgba, [10, 20, 30, 128, 10, 20, 30, 128]);
    }

    fn paletted_blp(alpha_bits: u32, tail: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0; 156 + 1024 + 4 + tail.len()];
        bytes[..4].copy_from_slice(b"BLP1");
        word(&mut bytes, 4, 1);
        word(&mut bytes, 8, alpha_bits);
        word(&mut bytes, 12, 2);
        word(&mut bytes, 16, 2);
        word(&mut bytes, 20, 5);
        word(&mut bytes, 28, 156 + 1024);
        word(&mut bytes, 92, 4 + tail.len() as u32);
        bytes[156 + 4..156 + 8].copy_from_slice(&[30, 20, 10, 0]);
        bytes[156 + 8..156 + 12].copy_from_slice(&[60, 50, 40, 0]);
        bytes[156 + 12..156 + 16].copy_from_slice(&[90, 80, 70, 0]);
        bytes[156 + 1024..156 + 1028].copy_from_slice(&[1, 2, 3, 1]);
        bytes[156 + 1028..].copy_from_slice(tail);
        bytes
    }

    #[test]
    fn blp_decodes_paletted_and_jpeg_content() {
        let eight = decode(&paletted_blp(8, &[255, 128, 64, 0])).unwrap();
        assert_eq!((eight.width, eight.height), (2, 2));
        assert_eq!(eight.rgba, [10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 64, 10, 20, 30, 0]);
        assert_eq!(decode(&paletted_blp(4, &[0x21, 0x43])).unwrap().rgba.iter().skip(3).step_by(4).copied().collect::<Vec<_>>(), [17, 34, 51, 68]);
        assert_eq!(decode(&paletted_blp(0, &[])).unwrap().rgba.iter().skip(3).step_by(4).copied().collect::<Vec<_>>(), [255; 4]);

        let solid = image_blp_pixels::DynamicImage::ImageRgba8(image_blp_pixels::RgbaImage::from_pixel(8, 8, image_blp_pixels::Rgba([200, 100, 50, 255])));
        let target = image_blp::convert::BlpTarget::Blp1(image_blp::convert::BlpOldFormat::Jpeg { has_alpha: true });
        let blp = image_blp::convert::image_to_blp(solid, false, target, image_blp::convert::FilterType::Nearest).unwrap();
        let jpeg = decode(&image_blp::encode::encode_blp(&blp).unwrap()).unwrap();
        assert_eq!((jpeg.width, jpeg.height), (8, 8));
        for pixel in jpeg.rgba.chunks_exact(4) {
            assert!(pixel.iter().zip([200u8, 100, 50, 255]).all(|(got, want)| got.abs_diff(want) <= 3), "{pixel:?}");
        }
    }

    #[test]
    fn dds_decodes_block_compressed_and_packed_files() {
        let mut dxt1 = vec![0; 136];
        dxt1[..4].copy_from_slice(b"DDS ");
        word(&mut dxt1, 4, 124);
        word(&mut dxt1, 8, 0x1007);
        word(&mut dxt1, 12, 4);
        word(&mut dxt1, 16, 4);
        word(&mut dxt1, 76, 32);
        word(&mut dxt1, 80, 4);
        word(&mut dxt1, 84, 0x3154_5844);
        dxt1[128..130].copy_from_slice(&0xf800u16.to_le_bytes());
        dxt1[130..132].copy_from_slice(&0x07e0u16.to_le_bytes());
        let decoded = decode(&dxt1).unwrap();
        assert_eq!((decoded.width, decoded.height), (4, 4));
        assert!(decoded.rgba.chunks_exact(4).all(|pixel| pixel == [255, 0, 0, 255]));

        let mut argb = vec![0; 128 + 16];
        argb[..4].copy_from_slice(b"DDS ");
        word(&mut argb, 4, 124);
        word(&mut argb, 8, 0x100f);
        word(&mut argb, 12, 2);
        word(&mut argb, 16, 2);
        word(&mut argb, 76, 32);
        word(&mut argb, 80, 0x41);
        word(&mut argb, 88, 32);
        word(&mut argb, 92, 0x00ff_0000);
        word(&mut argb, 96, 0x0000_ff00);
        word(&mut argb, 100, 0x0000_00ff);
        word(&mut argb, 104, 0xff00_0000);
        for pixel in argb[128..].chunks_exact_mut(4) {
            pixel.copy_from_slice(&[3, 2, 1, 200]);
        }
        let decoded = decode(&argb).unwrap();
        assert!(decoded.rgba.chunks_exact(4).all(|pixel| pixel == [1, 2, 3, 200]));
    }
}
