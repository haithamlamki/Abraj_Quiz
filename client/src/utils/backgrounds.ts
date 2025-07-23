// Utility functions for handling quiz background images and themes

export const getBackgroundImageUrl = (backgroundValue: string): string => {
  // If it's a data URL (base64 image), return it directly
  if (backgroundValue.startsWith('data:image/')) {
    return backgroundValue;
  }
  
  // Otherwise, return the theme-based background image
  const themeImages: Record<string, string> = {
    classroom: '/attached_assets/1694_1753144153239.jpg',
    space: '/attached_assets/space-background.jpg',
    ocean: '/attached_assets/ocean-background.jpg', 
    forest: '/attached_assets/forest-background.jpg',
    city: '/attached_assets/city-background.jpg'
  };
  
  return themeImages[backgroundValue] || themeImages.classroom;
};

export const getBackgroundStyle = (backgroundValue: string): React.CSSProperties => {
  const imageUrl = getBackgroundImageUrl(backgroundValue);
  
  return {
    backgroundImage: `url(${imageUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  };
};