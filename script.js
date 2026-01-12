// Initialize the map
const map = L.map('map').setView([20, 0], 2);

// Add CartoDB Positron tiles (cleaner, no territorial water borders)
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 19
}).addTo(map);

// Store added cities
const cities = [];
const markers = [];
const routeLines = [];
const labelPositions = []; // Store label positions for collision detection
const labelLines = []; // Store lines connecting labels to city dots when not adjacent

// DOM elements
const cityInput = document.getElementById('cityInput');
const addCityBtn = document.getElementById('addCityBtn');
const clearBtn = document.getElementById('clearBtn');
const testCitiesBtn = document.getElementById('testCitiesBtn');
const citiesList = document.getElementById('citiesList');
const arriveDate = document.getElementById('arriveDate');
const leaveDate = document.getElementById('leaveDate');

// Geocoding function using Nominatim API
async function geocodeCity(cityName) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cityName)}&limit=1`,
            {
                headers: {
                    'User-Agent': 'CityMapExplorer/1.0'
                }
            }
        );
        
        const data = await response.json();
        
        if (data.length === 0) {
            throw new Error('City not found');
        }
        
        return {
            name: data[0].display_name.split(',')[0],
            lat: parseFloat(data[0].lat),
            lon: parseFloat(data[0].lon),
            fullName: data[0].display_name
        };
    } catch (error) {
        throw new Error(`Failed to find city: ${error.message}`);
    }
}

// Geocoding function specifically for Japanese cities - ensures results are in Japan
async function geocodeCityInJapan(cityName) {
    try {
        // Add "Japan" to the query and restrict to Japan country code
        const query = `${cityName}, Japan`;
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=jp&limit=5`,
            {
                headers: {
                    'User-Agent': 'CityMapExplorer/1.0'
                }
            }
        );
        
        const data = await response.json();
        
        if (data.length === 0) {
            throw new Error(`City "${cityName}" not found in Japan`);
        }
        
        // Find the best match - prefer city over prefecture
        // Look for results that are cities, not prefectures
        let bestMatch = null;
        
        // First, try to find a city result (not a prefecture)
        for (const result of data) {
            const displayName = result.display_name.toLowerCase();
            const type = result.type ? result.type.toLowerCase() : '';
            const address = result.address || {};
            
            // Skip prefecture results
            if (displayName.includes('préfecture') || displayName.includes('prefecture') || 
                displayName.includes('都道府県') || type === 'administrative') {
                continue;
            }
            
            // Prefer city results
            if (type === 'city' || address.city || address.town || address.village) {
                bestMatch = result;
                break;
            }
            
            // If no city found yet, use this as fallback (but still skip prefectures)
            if (!bestMatch && displayName.includes('japan')) {
                bestMatch = result;
            }
        }
        
        // If no city found, use first result that's not a prefecture
        if (!bestMatch) {
            for (const result of data) {
                const displayName = result.display_name.toLowerCase();
                if (!displayName.includes('préfecture') && !displayName.includes('prefecture') && 
                    !displayName.includes('都道府県')) {
                    bestMatch = result;
                    break;
                }
            }
        }
        
        // Fallback to first result if still no match
        if (!bestMatch) {
            bestMatch = data[0];
        }
        
        // Double-check: verify country code if available
        if (bestMatch.address && bestMatch.address.country_code && bestMatch.address.country_code !== 'jp') {
            throw new Error(`City "${cityName}" found but not in Japan`);
        }
        
        // Extract city name - use the city name from address if available, otherwise use first part of display_name
        let extractedCityName = bestMatch.display_name.split(',')[0];
        if (bestMatch.address) {
            if (bestMatch.address.city) {
                extractedCityName = bestMatch.address.city;
            } else if (bestMatch.address.town) {
                extractedCityName = bestMatch.address.town;
            } else if (bestMatch.address.village) {
                extractedCityName = bestMatch.address.village;
            }
        }
        
        return {
            name: extractedCityName,
            lat: parseFloat(bestMatch.lat),
            lon: parseFloat(bestMatch.lon),
            fullName: bestMatch.display_name
        };
    } catch (error) {
        throw new Error(`Failed to find city in Japan: ${error.message}`);
    }
}

// Format date for display
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Format date for list display (dd Mmm format)
function formatDateForList(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const day = date.getDate();
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    return `${day} ${month}`;
}

// Format date range for display in list (dd Mmm format)
function formatDateRange(arriveDate, leaveDate) {
    if (!arriveDate && !leaveDate) return '';
    if (arriveDate && !leaveDate) return `Arrive: ${formatDateForList(arriveDate)}`;
    if (!arriveDate && leaveDate) return `Leave: ${formatDateForList(leaveDate)}`;
    return `${formatDateForList(arriveDate)} - ${formatDateForList(leaveDate)}`;
}

// Format abbreviated date (e.g., "3 Jun" or "30 Jun")
function formatAbbreviatedDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const day = date.getDate();
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    return `${day} ${month}`;
}

// Format abbreviated date range for labels (e.g., "3-5 Jun" or "30 Jun-12 Jul")
// For origin city (isOrigin=true), shows "dep. [leave date]" instead
function formatAbbreviatedDateRange(arriveDate, leaveDate, isOrigin = false) {
    if (!arriveDate && !leaveDate) return '';
    
    // Origin city shows only departure date
    if (isOrigin && leaveDate) {
        return `dep. ${formatAbbreviatedDate(leaveDate)}`;
    }
    
    // If arrival date but no departure date, show "Arr. [date]"
    if (arriveDate && !leaveDate) return `Arr. ${formatAbbreviatedDate(arriveDate)}`;
    if (!arriveDate && leaveDate) return formatAbbreviatedDate(leaveDate);
    
    const arrive = new Date(arriveDate);
    const leave = new Date(leaveDate);
    const arriveDay = arrive.getDate();
    const leaveDay = leave.getDate();
    const arriveMonth = arrive.toLocaleDateString('en-US', { month: 'short' });
    const leaveMonth = leave.toLocaleDateString('en-US', { month: 'short' });
    
    // Same month: "3-5 Jun"
    if (arriveMonth === leaveMonth) {
        return `${arriveDay}-${leaveDay} ${arriveMonth}`;
    }
    // Different months: "30 Jun-12 Jul"
    return `${arriveDay} ${arriveMonth}-${leaveDay} ${leaveMonth}`;
}

// Calculate number of days between dates
function calculateDays(arriveDate, leaveDate) {
    if (!arriveDate || !leaveDate) return 0;
    const arrive = new Date(arriveDate);
    const leave = new Date(leaveDate);
    const diffTime = Math.abs(leave - arrive);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

// Get departure date for a city (leave date, or arrive date if no leave date)
function getDepartureDate(city) {
    if (city.leaveDate) return new Date(city.leaveDate);
    if (city.arriveDate) return new Date(city.arriveDate);
    return null;
}

// Get arrival date for a city
function getArrivalDate(city) {
    if (city.arriveDate) return new Date(city.arriveDate);
    return null;
}

// Sort cities by travel order (chronological by departure/arrival dates)
function sortCitiesByTravelOrder() {
    return [...cities].sort((a, b) => {
        const aDeparture = getDepartureDate(a);
        const bDeparture = getDepartureDate(b);
        const aArrival = getArrivalDate(a);
        const bArrival = getArrivalDate(b);
        
        // If both have departure dates, sort by departure
        if (aDeparture && bDeparture) {
            return aDeparture - bDeparture;
        }
        
        // If one has departure and other doesn't, prioritize the one with departure
        if (aDeparture && !bDeparture) return -1;
        if (!aDeparture && bDeparture) return 1;
        
        // If both have arrival dates, sort by arrival
        if (aArrival && bArrival) {
            return aArrival - bArrival;
        }
        
        // If no dates, maintain original order
        return 0;
    });
}

// Generate points for a curved path using bezier curve with direction
function generateCurvedPath(start, end, direction = 'right', numPoints = 50) {
    const latDiff = end.lat - start.lat;
    const lonDiff = end.lon - start.lon;
    
    // Calculate control points for bezier curve (offset perpendicular)
    const offset = 0.15; // Curve amount
    const midLat = (start.lat + end.lat) / 2;
    const midLon = (start.lon + end.lon) / 2;
    
    // Calculate perpendicular vector to the line from start to end
    // Perpendicular: rotate 90 degrees (swap and negate one component)
    // For direction: 'right' curves to the right when facing from start to end
    //                'left' curves to the left when facing from start to end
    //                'up' curves above the line (northward)
    //                'down' curves below the line (southward)
    
    let controlLat, controlLon;
    const baseOffset = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * offset;
    
    if (direction === 'right') {
        // Curve to the right: perpendicular vector pointing right
        controlLat = midLat + Math.abs(lonDiff) * offset;
        controlLon = midLon - Math.abs(latDiff) * offset;
    } else if (direction === 'left') {
        // Curve to the left: opposite perpendicular
        controlLat = midLat - Math.abs(lonDiff) * offset;
        controlLon = midLon + Math.abs(latDiff) * offset;
    } else if (direction === 'up') {
        // Curve upward (north): perpendicular rotated 90 degrees
        controlLat = midLat + baseOffset;
        controlLon = midLon;
    } else if (direction === 'down') {
        // Curve downward (south): opposite - ensure it's actually downward
        // Use negative baseOffset to curve southward
        controlLat = midLat - baseOffset;
        controlLon = midLon;
    } else {
        // Default to right
        controlLat = midLat + Math.abs(lonDiff) * offset;
        controlLon = midLon - Math.abs(latDiff) * offset;
    }
    
    const points = [];
    for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        // Quadratic bezier curve
        const lat = (1 - t) * (1 - t) * start.lat + 2 * (1 - t) * t * controlLat + t * t * end.lat;
        const lon = (1 - t) * (1 - t) * start.lon + 2 * (1 - t) * t * controlLon + t * t * end.lon;
        points.push([lat, lon]);
    }
    
    return points;
}

// Check if a curve path overlaps with existing curves (returns boolean)
function checkCurveOverlap(pathPoints, existingCurves, minDistance = 0.01) {
    return countCurveOverlaps(pathPoints, existingCurves, minDistance) > 0;
}

// Count how many overlaps a curve has with existing curves (returns number)
function countCurveOverlaps(pathPoints, existingCurves, minDistance = 0.01) {
    if (!pathPoints || !Array.isArray(pathPoints) || pathPoints.length === 0) {
        return 0;
    }
    
    // Sample points along the new curve (every 10th point for performance)
    const samplePoints = [];
    for (let i = 0; i < pathPoints.length; i += 10) {
        const point = pathPoints[i];
        if (point && Array.isArray(point) && point.length >= 2 &&
            typeof point[0] === 'number' && typeof point[1] === 'number' &&
            !isNaN(point[0]) && !isNaN(point[1])) {
            samplePoints.push(point);
        }
    }
    
    if (samplePoints.length === 0) {
        return 0;
    }
    
    let overlapCount = 0;
    
    // Check each sample point against existing curves
    for (const samplePoint of samplePoints) {
        for (const existingCurve of existingCurves) {
            if (!existingCurve || !existingCurve.points || !Array.isArray(existingCurve.points)) {
                continue;
            }
            
            // Sample existing curve points too (every 10th point)
            for (let j = 0; j < existingCurve.points.length; j += 10) {
                const existingPoint = existingCurve.points[j];
                if (!existingPoint || !Array.isArray(existingPoint) || existingPoint.length < 2) {
                    continue;
                }
                
                if (typeof existingPoint[0] !== 'number' || typeof existingPoint[1] !== 'number' ||
                    isNaN(existingPoint[0]) || isNaN(existingPoint[1])) {
                    continue;
                }
                
                const latDiff = Math.abs(samplePoint[0] - existingPoint[0]);
                const lonDiff = Math.abs(samplePoint[1] - existingPoint[1]);
                const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
                
                if (distance < minDistance) {
                    overlapCount++; // Overlap detected
                }
            }
        }
    }
    
    return overlapCount;
}

// Create arrow icon for polyline with rotation (subtle, no outline)
function createArrowIcon(angle) {
    // Create a subtle, smaller SVG arrow without white outline
    const svg = `
        <svg width="16" height="16" viewBox="0 0 16 16" style="transform: rotate(${angle}deg); transform-origin: center; opacity: 0.7;">
            <path d="M 2 8 L 12 3 L 12 6 L 14 6 L 14 10 L 12 10 L 12 13 Z" 
                  fill="#667eea" 
                  stroke="none"/>
        </svg>
    `;
    
    return L.divIcon({
        className: 'arrow-icon',
        html: svg,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
}

// Track curve index for alternating up/down
let curveIndex = 0;

// Create curved arrow between two points, alternating between up and down
function createCurvedArrow(from, to, existingCurves = [], alternateDirection = null) {
    // Validate input coordinates
    if (!from || !to || 
        typeof from.lat !== 'number' || typeof from.lon !== 'number' ||
        typeof to.lat !== 'number' || typeof to.lon !== 'number' ||
        isNaN(from.lat) || isNaN(from.lon) || isNaN(to.lat) || isNaN(to.lon)) {
        console.error('Invalid coordinates in createCurvedArrow:', from, to);
        return null;
    }
    
    // Use provided direction or alternate between 'up' and 'down'
    let selectedDirection;
    if (alternateDirection !== null) {
        selectedDirection = alternateDirection;
    } else {
        // Alternate between 'up' and 'down'
        selectedDirection = (curveIndex % 2 === 0) ? 'up' : 'down';
        curveIndex++;
    }
    
    const pathPoints = generateCurvedPath(
        { lat: from.lat, lon: from.lon },
        { lat: to.lat, lon: to.lon },
        selectedDirection
    );
    
    if (!pathPoints || pathPoints.length === 0) {
        // Fallback to 'up' if generation failed
        selectedDirection = 'up';
        return createCurvedArrow(from, to, existingCurves, 'up');
    }
    
    // Create polyline with curved path
    // Use negative zIndexOffset so routes appear below city markers
    const polyline = L.polyline(pathPoints, {
        color: '#667eea',
        weight: 4,
        opacity: 0.9,
        smoothFactor: 1,
        zIndexOffset: -500 // Below city markers
    }).addTo(map);
    
    const arrowMarkers = [];
    
    // Find the point where the curve touches the destination city dot
    // City dot radius is 15 pixels, need to find intersection point
    const cityDotRadius = 15; // pixels
    const destLat = to.lat;
    const destLon = to.lon;
    
    // Convert destination city to screen coordinates
    const destScreenPoint = map.latLngToContainerPoint([destLat, destLon]);
    const destScreenX = destScreenPoint.x;
    const destScreenY = destScreenPoint.y;
    
    // Find the point on the curve closest to the city center (working backwards from end)
    // Then calculate where it intersects the city dot circle
    let closestPoint = null;
    let closestDistance = Infinity;
    let closestIndex = -1;
    let closestScreen = null;
    
    // Work backwards from the end of the curve to find the closest point
    for (let i = pathPoints.length - 1; i >= 0; i--) {
        const point = pathPoints[i];
        const pointScreen = map.latLngToContainerPoint([point[0], point[1]]);
        const dx = pointScreen.x - destScreenX;
        const dy = pointScreen.y - destScreenY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = i;
            closestPoint = point;
            closestScreen = pointScreen;
        }
        
        // Stop searching once we're far from the city (curve is moving away)
        if (distance > cityDotRadius * 4 && closestIndex >= 0) {
            break;
        }
    }
    
    // Calculate intersection point on the city dot circle and arrow angle
    let arrowLat, arrowLon, arrowAngle;
    
    if (closestPoint && closestIndex >= 0 && closestScreen) {
        const dx = closestScreen.x - destScreenX;
        const dy = closestScreen.y - destScreenY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
            // Normalize direction vector from city center to curve point
            const dirX = dx / distance;
            const dirY = dy / distance;
            
            // Calculate point on circle edge (cityDotRadius from center)
            // This is where the curve touches the city dot
            const intersectionX = destScreenX + dirX * cityDotRadius;
            const intersectionY = destScreenY + dirY * cityDotRadius;
            
            // Convert back to lat/lon
            const intersectionLatLng = map.containerPointToLatLng([intersectionX, intersectionY]);
            arrowLat = intersectionLatLng.lat;
            arrowLon = intersectionLatLng.lng;
            
            // Calculate angle - arrow should point from curve toward city center
            // The direction vector points from city to curve, so reverse it for arrow direction
            arrowAngle = Math.atan2(-dirY, -dirX) * 180 / Math.PI;
        } else {
            // Fallback: use end point
            const endPoint = pathPoints[pathPoints.length - 1];
            arrowLat = endPoint[0];
            arrowLon = endPoint[1];
            const prevPoint = pathPoints[Math.max(0, pathPoints.length - 3)];
            const destDx = arrowLon - prevPoint[1];
            const destDy = arrowLat - prevPoint[0];
            arrowAngle = Math.atan2(destDy, destDx) * 180 / Math.PI;
        }
    } else {
        // Fallback: use end point
        const endPoint = pathPoints[pathPoints.length - 1];
        arrowLat = endPoint[0];
        arrowLon = endPoint[1];
        const prevPoint = pathPoints[Math.max(0, pathPoints.length - 3)];
        const destDx = arrowLon - prevPoint[1];
        const destDy = arrowLat - prevPoint[0];
        arrowAngle = Math.atan2(destDy, destDx) * 180 / Math.PI;
    }
    
    // Add arrowhead at the intersection point where curve touches city dot
    const destArrowMarker = L.marker([arrowLat, arrowLon], {
        icon: createArrowIcon(arrowAngle)
    }).addTo(map);
    
    arrowMarkers.push(destArrowMarker);
    
    return { polyline, arrowMarkers, points: pathPoints, direction: selectedDirection };
}

// Draw travel routes between cities
function drawTravelRoutes() {
    // Remove existing routes
    routeLines.forEach(route => {
        if (route.polyline) {
            map.removeLayer(route.polyline);
        }
        if (route.arrowMarkers) {
            route.arrowMarkers.forEach(marker => {
                map.removeLayer(marker);
            });
        }
    });
    routeLines.length = 0;
    
    // Sort cities by travel order
    const sortedCities = sortCitiesByTravelOrder();
    
    // Only draw routes if cities have dates
    const citiesWithDates = sortedCities.filter(city => 
        city.arriveDate || city.leaveDate
    );
    
    if (citiesWithDates.length < 2) {
        return;
    }
    
    // Reset curve index for this drawing session
    curveIndex = 0;
    
    // Collect existing curves for overlap detection
    const existingCurves = routeLines.map(route => ({
        points: route.points || []
    }));
    
    // Draw arrows between consecutive cities
    for (let i = 0; i < citiesWithDates.length - 1; i++) {
        const from = citiesWithDates[i];
        const to = citiesWithDates[i + 1];
        
        // Only draw if there's a valid travel sequence (departure from first, arrival at second)
        const fromDeparture = getDepartureDate(from);
        const toArrival = getArrivalDate(to);
        
        if (fromDeparture && toArrival && toArrival >= fromDeparture) {
            // Validate city coordinates before creating arrow
            if (from && to && 
                typeof from.lat === 'number' && typeof from.lon === 'number' &&
                typeof to.lat === 'number' && typeof to.lon === 'number' &&
                !isNaN(from.lat) && !isNaN(from.lon) && !isNaN(to.lat) && !isNaN(to.lon)) {
                const route = createCurvedArrow(
                    { lat: from.lat, lon: from.lon },
                    { lat: to.lat, lon: to.lon },
                    existingCurves
                );
                if (route) {
                    routeLines.push(route);
                    // Add this route to existing curves for next iteration
                    existingCurves.push({ points: route.points });
                }
            } else {
                console.warn('Skipping route due to invalid coordinates:', from, to);
            }
        }
    }
}

// Count how many elements a label bounding box overlaps with
// For labels, we're strict: any overlap with another label is not allowed
function countLabelOverlaps(labelX, labelY, existingElements, labelWidth = 120, labelHeight = 40) {
    // Label bounding box (approximate size)
    const labelLeft = labelX;
    const labelRight = labelX + labelWidth;
    const labelTop = labelY;
    const labelBottom = labelY + labelHeight;
    
    let overlapCount = 0;
    let labelOverlapCount = 0; // Track label-to-label overlaps separately
    
    for (const element of existingElements) {
        let elementLeft, elementRight, elementTop, elementBottom;
        
        if (element.width && element.height) {
            // Element has explicit width/height (like labels)
            elementLeft = element.x;
            elementRight = element.x + element.width;
            elementTop = element.y;
            elementBottom = element.y + element.height;
            
            // Check if this is a label (has width/height and is likely a label)
            // Labels must not overlap with other labels - use strict check
            const padding = 2; // Minimal padding for labels
            if (!(labelRight + padding < elementLeft || labelLeft - padding > elementRight || 
                  labelBottom + padding < elementTop || labelTop - padding > elementBottom)) {
                labelOverlapCount++; // Label-to-label overlap - not allowed
            }
        } else {
            // Element is circular (cities, arrows) - labels can overlap these slightly
            const elementRadius = element.radius || 20;
            elementLeft = element.x - elementRadius;
            elementRight = element.x + elementRadius;
            elementTop = element.y - elementRadius;
            elementBottom = element.y + elementRadius;
            
            // Check if bounding boxes overlap (with small padding)
            const padding = 5;
            if (!(labelRight + padding < elementLeft || labelLeft - padding > elementRight || 
                  labelBottom + padding < elementTop || labelTop - padding > elementBottom)) {
                overlapCount++; // Overlap with non-label element
            }
        }
    }
    
    // Return a high penalty for label overlaps (they're not allowed)
    // Add regular overlaps as well
    return labelOverlapCount * 1000 + overlapCount;
}

// Get all occupied screen positions (cities, arrows, existing labels)
function getOccupiedPositions() {
    const occupied = [];
    
    // Add city positions
    cities.forEach(city => {
        if (city && typeof city.lat === 'number' && typeof city.lon === 'number' && 
            !isNaN(city.lat) && !isNaN(city.lon)) {
            try {
                const screenPoint = map.latLngToContainerPoint([city.lat, city.lon]);
                occupied.push({ x: screenPoint.x, y: screenPoint.y, type: 'city', radius: 20 });
            } catch (e) {
                console.warn('Invalid city coordinates:', city);
            }
        }
    });
    
    // Add arrow positions (along the path) - use stored points instead of polyline._latlngs
    routeLines.forEach(route => {
        if (route && route.points && Array.isArray(route.points)) {
            route.points.forEach(point => {
                if (point && Array.isArray(point) && point.length >= 2 && 
                    typeof point[0] === 'number' && typeof point[1] === 'number' &&
                    !isNaN(point[0]) && !isNaN(point[1])) {
                    try {
                        const screenPoint = map.latLngToContainerPoint([point[0], point[1]]);
                        occupied.push({ x: screenPoint.x, y: screenPoint.y, type: 'arrow', radius: 10 });
                    } catch (e) {
                        console.warn('Invalid arrow point:', point);
                    }
                }
            });
        }
    });
    
    // Add existing label positions (use stored screen coordinates if available)
    // These are labels that have already been positioned
    labelPositions.forEach((label, index) => {
        if (label) {
            // Use stored screen coordinates if available (more accurate)
            if (typeof label.x === 'number' && typeof label.y === 'number' && 
                !isNaN(label.x) && !isNaN(label.y)) {
                // Get actual label size for this city
                const city = cities[index];
                if (city) {
                    const sequence = getCitySequence(city);
                    const isOrigin = sequence === 0;
                    const dateRange = formatAbbreviatedDateRange(city.arriveDate, city.leaveDate, isOrigin);
                    
                    // Create a temporary element to measure actual label size
                    const tempDiv = document.createElement('div');
                    tempDiv.className = 'city-label';
                    tempDiv.style.position = 'absolute';
                    tempDiv.style.visibility = 'hidden';
                    tempDiv.style.whiteSpace = 'nowrap';
                    tempDiv.innerHTML = `
                        <div class="city-label-name">${city.name}</div>
                        ${dateRange ? `<div class="city-label-dates">${dateRange}</div>` : ''}
                    `;
                    document.body.appendChild(tempDiv);
                    const actualWidth = tempDiv.offsetWidth;
                    const actualHeight = tempDiv.offsetHeight;
                    document.body.removeChild(tempDiv);
                    
                    // Label bounding box with actual size
                    occupied.push({ 
                        x: label.x, 
                        y: label.y, 
                        type: 'label', 
                        radius: 60,
                        width: actualWidth,
                        height: actualHeight
                    });
                } else {
                    // Fallback to estimated size
                    occupied.push({ 
                        x: label.x, 
                        y: label.y, 
                        type: 'label', 
                        radius: 60,
                        width: 120,
                        height: 40
                    });
                }
            } else if (label.lat && label.lon) {
                // Fallback: calculate from lat/lon
                try {
                    const screenPoint = map.latLngToContainerPoint([label.lat, label.lon]);
                    occupied.push({ 
                        x: screenPoint.x + (label.offsetX || 0), 
                        y: screenPoint.y + (label.offsetY || 0), 
                        type: 'label', 
                        radius: 60,
                        width: 120,
                        height: 40
                    });
                } catch (e) {
                    console.warn('Invalid label position:', label);
                }
            }
        }
    });
    
    return occupied;
}

// Simplified label positioning - try 8 positions around city dot
function calculateLabelPosition(cityLat, cityLon) {
    const cityDotRadius = 15;
    const labelWidth = 120;
    const labelHeight = 40;
    const spacing = 5; // Space between label and dot
    
    // Convert city to screen coordinates
    const cityScreen = map.latLngToContainerPoint([cityLat, cityLon]);
    const cityX = cityScreen.x;
    const cityY = cityScreen.y;
    
    // Get map bounds
    const mapSize = map.getSize();
    const mapBounds = { left: 0, right: mapSize.x, top: 0, bottom: mapSize.y };
    
    // Get occupied positions
    const occupied = getOccupiedPositions();
    
    // Calculate center of gravity (centroid) of all city dots
    let centerX = 0;
    let centerY = 0;
    if (cities.length > 0) {
        cities.forEach(city => {
            const screenPoint = map.latLngToContainerPoint([city.lat, city.lon]);
            centerX += screenPoint.x;
            centerY += screenPoint.y;
        });
        centerX /= cities.length;
        centerY /= cities.length;
    } else {
        // Fallback to city position if no other cities
        centerX = cityX;
        centerY = cityY;
    }
    
    // Calculate direction from center of gravity to this city
    const dx = cityX - centerX;
    const dy = cityY - centerY;
    
    // Determine primary direction away from center
    // We'll prioritize positions in this direction
    let preferredDirections = [];
    if (Math.abs(dx) > Math.abs(dy)) {
        // More horizontal
        if (dx > 0) {
            preferredDirections = ['E', 'NE', 'SE', 'N', 'S', 'W', 'NW', 'SW']; // East side
        } else {
            preferredDirections = ['W', 'NW', 'SW', 'N', 'S', 'E', 'NE', 'SE']; // West side
        }
    } else {
        // More vertical
        if (dy > 0) {
            preferredDirections = ['S', 'SE', 'SW', 'E', 'W', 'N', 'NE', 'NW']; // South side
        } else {
            preferredDirections = ['N', 'NE', 'NW', 'E', 'W', 'S', 'SE', 'SW']; // North side
        }
    }
    
    // Generate positions: first try 8 positions touching the dot, then try further positions if needed
    const baseSpacing = spacing;
    const maxSpacing = 100; // Maximum distance to try
    const spacingSteps = [baseSpacing, baseSpacing * 2, baseSpacing * 4, baseSpacing * 8]; // Try increasing distances
    
    let bestPos = null;
    let bestScore = Infinity;
    let foundGoodPosition = false;
    
    // Try each spacing distance
    for (const currentSpacing of spacingSteps) {
        // 8 positions: corners first, then edges
        const allPositions = [
            // Corners
            { dir: 'NW', labelX: cityX - cityDotRadius - labelWidth - currentSpacing, labelY: cityY - cityDotRadius - labelHeight - currentSpacing, className: 'label-nw' },
            { dir: 'NE', labelX: cityX + cityDotRadius + currentSpacing, labelY: cityY - cityDotRadius - labelHeight - currentSpacing, className: 'label-ne' },
            { dir: 'SE', labelX: cityX + cityDotRadius + currentSpacing, labelY: cityY + cityDotRadius + currentSpacing, className: 'label-se' },
            { dir: 'SW', labelX: cityX - cityDotRadius - labelWidth - currentSpacing, labelY: cityY + cityDotRadius + currentSpacing, className: 'label-sw' },
            // Edges
            { dir: 'N', labelX: cityX - labelWidth / 2, labelY: cityY - cityDotRadius - labelHeight - currentSpacing, className: 'label-n' },
            { dir: 'E', labelX: cityX + cityDotRadius + currentSpacing, labelY: cityY - labelHeight / 2, className: 'label-e' },
            { dir: 'S', labelX: cityX - labelWidth / 2, labelY: cityY + cityDotRadius + currentSpacing, className: 'label-s' },
            { dir: 'W', labelX: cityX - cityDotRadius - labelWidth - currentSpacing, labelY: cityY - labelHeight / 2, className: 'label-w' }
        ];
        
        // Reorder positions based on preferred direction (away from center of gravity)
        const positions = [];
        for (const preferredDir of preferredDirections) {
            const pos = allPositions.find(p => p.dir === preferredDir);
            if (pos) {
                positions.push(pos);
            }
        }
        
        // Try each position at this spacing
        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            const labelX = pos.labelX;
            const labelY = pos.labelY;
            const labelRight = labelX + labelWidth;
            const labelBottom = labelY + labelHeight;
            
            // Check if label is within bounds
            if (labelX < mapBounds.left || labelRight > mapBounds.right ||
                labelY < mapBounds.top || labelBottom > mapBounds.bottom) {
                continue;
            }
            
            // Check for overlaps - labels must not overlap with other labels
            const overlapCount = countLabelOverlaps(labelX, labelY, occupied, labelWidth, labelHeight);
            
            // Only accept position if no label overlaps (overlapCount < 1000 means no label overlaps)
            if (overlapCount < 1000) {
                // Found good position - prioritize preferred direction (lower index = higher priority)
                const distanceFromDot = Math.sqrt((labelX - cityX) * (labelX - cityX) + (labelY - cityY) * (labelY - cityY));
                // Score: priority index (lower is better) + small distance bonus
                // This ensures preferred directions are chosen even if slightly further
                const score = i * 1000 + distanceFromDot;
                
                if (score < bestScore) {
                    bestScore = score;
                    bestPos = { ...pos, distance: distanceFromDot };
                    foundGoodPosition = true;
                    
                    // If this is one of the top 3 preferred positions and has no overlaps, use it immediately
                    if (i < 3) {
                        break; // Break out of position loop
                    }
                }
            } else {
                // Track best position even with overlaps (for fallback)
                const distanceFromDot = Math.sqrt((labelX - cityX) * (labelX - cityX) + (labelY - cityY) * (labelY - cityY));
                const boundsPenalty = (labelX < mapBounds.left || labelRight > mapBounds.right ||
                    labelY < mapBounds.top || labelBottom > mapBounds.bottom) ? 100 : 0;
                // Score: priority index + overlap penalty + distance
                const score = i * 1000 + overlapCount * 10 + boundsPenalty + distanceFromDot * 0.1;
                
                if (score < bestScore) {
                    bestScore = score;
                    bestPos = { ...pos, distance: distanceFromDot };
                }
            }
        }
        
        // If we found a good position (no overlaps) in preferred direction, use it
        if (bestPos && bestPos.overlapCount !== undefined && bestPos.overlapCount < 1000) {
            break; // Break out of spacing loop
        }
    }
    
    // If no good position found, use best available
    if (!bestPos) {
        // Fallback to preferred direction (first in preferredDirections list)
        const fallbackDir = preferredDirections[0];
        let fallbackX, fallbackY, fallbackClassName;
        
        switch(fallbackDir) {
            case 'NW':
                fallbackX = cityX - cityDotRadius - labelWidth - spacing;
                fallbackY = cityY - cityDotRadius - labelHeight - spacing;
                fallbackClassName = 'label-nw';
                break;
            case 'NE':
                fallbackX = cityX + cityDotRadius + spacing;
                fallbackY = cityY - cityDotRadius - labelHeight - spacing;
                fallbackClassName = 'label-ne';
                break;
            case 'SE':
                fallbackX = cityX + cityDotRadius + spacing;
                fallbackY = cityY + cityDotRadius + spacing;
                fallbackClassName = 'label-se';
                break;
            case 'SW':
                fallbackX = cityX - cityDotRadius - labelWidth - spacing;
                fallbackY = cityY + cityDotRadius + spacing;
                fallbackClassName = 'label-sw';
                break;
            case 'N':
                fallbackX = cityX - labelWidth / 2;
                fallbackY = cityY - cityDotRadius - labelHeight - spacing;
                fallbackClassName = 'label-n';
                break;
            case 'E':
                fallbackX = cityX + cityDotRadius + spacing;
                fallbackY = cityY - labelHeight / 2;
                fallbackClassName = 'label-e';
                break;
            case 'S':
                fallbackX = cityX - labelWidth / 2;
                fallbackY = cityY + cityDotRadius + spacing;
                fallbackClassName = 'label-s';
                break;
            case 'W':
                fallbackX = cityX - cityDotRadius - labelWidth - spacing;
                fallbackY = cityY - labelHeight / 2;
                fallbackClassName = 'label-w';
                break;
            default:
                fallbackX = cityX + cityDotRadius + spacing;
                fallbackY = cityY - cityDotRadius - labelHeight - spacing;
                fallbackClassName = 'label-ne';
        }
        
        bestPos = {
            dir: fallbackDir,
            labelX: fallbackX,
            labelY: fallbackY,
            className: fallbackClassName,
            distance: spacing
        };
    }
    
    const offsetX = bestPos.labelX - cityX;
    const offsetY = bestPos.labelY - cityY;
    const isAdjacent = bestPos.distance <= cityDotRadius + labelWidth + spacing * 2;
    
    labelPositions.push({ 
        x: bestPos.labelX, 
        y: bestPos.labelY, 
        lat: cityLat, 
        lon: cityLon,
        offsetX: offsetX,
        offsetY: offsetY,
        isAdjacent: isAdjacent,
        needsLine: !isAdjacent, // Draw line if not adjacent
        className: bestPos.className
    });
    
    return { offsetX: offsetX, offsetY: offsetY, className: bestPos.className, anchorX: 0, anchorY: 0 };
}

// Get sequence number for a city based on travel order (0-based: 0, 1, 2, ...)
function getCitySequence(city) {
    const sortedCities = sortCitiesByTravelOrder();
    const index = sortedCities.findIndex(c => c.name === city.name && c.lat === city.lat && c.lon === city.lon);
    return index >= 0 ? index : null;
}

// Convert number to Unicode circled digit (1-based for display: 1→①, 2→②, etc.)
// Note: 0 should display as "START", not a circled number
function getCircledNumber(num) {
    if (num === 0) {
        return 'START'; // First city shows "START"
    }
    if (num < 1 || num > 20) {
        // For numbers > 20, use regular number with parentheses or fallback
        return num.toString();
    }
    // Unicode circled digits: ① (U+2460) through ⑳ (U+2473)
    // num is 1-based for display (1→①, 2→②, etc.)
    return String.fromCharCode(0x2460 + num - 1);
}

// Add city marker to map (without label - labels added separately)
function addCityMarker(city, showLabel = false) {
    const sequence = getCitySequence(city);
    const isOrigin = sequence === 0;
    const dateRange = formatAbbreviatedDateRange(city.arriveDate, city.leaveDate, isOrigin);
    
    // Display house icon for first city (sequence 0), otherwise show simple digit
    // For sequence 1, 2, 3... we want to show 1, 2, 3... (simple digits)
    const houseIcon = sequence === 0 ? `
        <svg width="14" height="14" viewBox="0 0 14 14" style="display: block; opacity: 1;">
            <path d="M7 1 L1 6 L1 13 L5 13 L5 9 L9 9 L9 13 L13 13 L13 6 Z" fill="white" stroke="none" opacity="1"/>
        </svg>
    ` : '';
    const displayText = sequence === 0 ? '' : (sequence !== null ? sequence.toString() : '');
    
    // Create custom icon with sequence number (no label yet)
    const icon = L.divIcon({
        className: 'city-marker',
        html: `
            <div class="city-marker-wrapper">
                <div class="city-dot">
                    ${houseIcon}
                    <span class="city-sequence">${displayText}</span>
                </div>
                ${showLabel ? `
                <div class="city-label">
                    <div class="city-label-name">${city.name}</div>
                    ${dateRange ? `<div class="city-label-dates">${dateRange}</div>` : ''}
                </div>
                ` : ''}
            </div>
        `,
        iconSize: [null, null],
        iconAnchor: [15, 15],
        popupAnchor: [0, -15]
    });
    
    const marker = L.marker([city.lat, city.lon], { icon: icon }).addTo(map);
    
    const days = calculateDays(city.arriveDate, city.leaveDate);
    let popupContent = `<b>${city.name}</b><br>${city.fullName}`;
    if (city.arriveDate || city.leaveDate) {
        popupContent += `<br><small style="color: #666;">${formatDateRange(city.arriveDate, city.leaveDate)}</small>`;
    }
    if (days > 0) {
        popupContent += `<br><small style="color: #666;">${days} ${days === 1 ? 'day' : 'days'}</small>`;
    }
    marker.bindPopup(popupContent);
    
    return marker;
}

// Simplified label marker creation - position after measuring actual size
function addLabelToMarker(marker, city, labelPos) {
    if (!labelPos || labelPos.offsetX === undefined || labelPos.offsetY === undefined) {
        console.error('Invalid labelPos:', labelPos);
        return null;
    }
    
    // Check if this is the origin city (sequence 0)
    const sequence = getCitySequence(city);
    const isOrigin = sequence === 0;
    const dateRange = formatAbbreviatedDateRange(city.arriveDate, city.leaveDate, isOrigin);
    
    // Create a temporary element to measure actual label size
    const tempDiv = document.createElement('div');
    tempDiv.className = 'city-label';
    tempDiv.style.position = 'absolute';
    tempDiv.style.visibility = 'hidden';
    tempDiv.style.whiteSpace = 'nowrap';
    tempDiv.innerHTML = `
        <div class="city-label-name">${city.name}</div>
        ${dateRange ? `<div class="city-label-dates">${dateRange}</div>` : ''}
    `;
    document.body.appendChild(tempDiv);
    
    // Measure actual size
    const actualWidth = tempDiv.offsetWidth;
    const actualHeight = tempDiv.offsetHeight;
    document.body.removeChild(tempDiv);
    
    // Get city screen position
    const cityScreen = map.latLngToContainerPoint([city.lat, city.lon]);
    
    // Recalculate position based on actual label size
    // Adjust offsetX/Y to account for actual size vs estimated size
    const estimatedWidth = 120;
    const estimatedHeight = 40;
    const widthDiff = actualWidth - estimatedWidth;
    const heightDiff = actualHeight - estimatedHeight;
    
    // Adjust position based on direction
    let adjustedX = cityScreen.x + labelPos.offsetX;
    let adjustedY = cityScreen.y + labelPos.offsetY;
    
    // Adjust for center-aligned positions (N, S)
    if (labelPos.className && (labelPos.className.includes('label-n') || labelPos.className.includes('label-s'))) {
        adjustedX -= widthDiff / 2;
    }
    // Adjust for left-aligned positions (W, SW, NW)
    if (labelPos.className && (labelPos.className.includes('label-w') || labelPos.className.includes('label-sw') || labelPos.className.includes('label-nw'))) {
        adjustedX -= widthDiff;
    }
    // Adjust for vertical center (E, W)
    if (labelPos.className && (labelPos.className.includes('label-e') || labelPos.className.includes('label-w'))) {
        adjustedY -= heightDiff / 2;
    }
    // Adjust for top-aligned (N, NE, NW)
    if (labelPos.className && (labelPos.className.includes('label-n'))) {
        adjustedY -= heightDiff;
    }
    
    // Convert to lat/lng
    const labelLatLng = map.containerPointToLatLng([adjustedX, adjustedY]);
    
    // Create label marker at calculated position
    const labelIcon = L.divIcon({
        className: `city-label-marker ${labelPos.className || ''}`,
        html: `
            <div class="city-label">
                <div class="city-label-name">${city.name}</div>
                ${dateRange ? `<div class="city-label-dates">${dateRange}</div>` : ''}
            </div>
        `,
        iconSize: [null, null],
        iconAnchor: [0, 0] // Anchor at top-left
    });
    
    const labelMarker = L.marker(labelLatLng, { 
        icon: labelIcon,
        interactive: false,
        zIndexOffset: -1000
    }).addTo(map);
    
    // Update labelPos with actual size for line drawing
    labelPos.actualWidth = actualWidth;
    labelPos.actualHeight = actualHeight;
    labelPos.actualX = adjustedX;
    labelPos.actualY = adjustedY;
    
    // Draw line if needed
    if (labelPos.needsLine || !labelPos.isAdjacent) {
        drawLabelLine(city, labelPos, labelMarker);
    }
    
    return labelMarker;
}

// Draw a black line from label's closest edge point to city dot
function drawLabelLine(city, labelPos, labelMarker) {
    const cityDotRadius = 15;
    // Use actual size if available, otherwise fall back to estimated
    const labelWidth = labelPos.actualWidth || 120;
    const labelHeight = labelPos.actualHeight || 40;
    
    // Get screen coordinates
    const cityScreenPoint = map.latLngToContainerPoint([city.lat, city.lon]);
    // Use actual position if available, otherwise calculate from offset
    const labelX = labelPos.actualX !== undefined ? labelPos.actualX : (cityScreenPoint.x + labelPos.offsetX);
    const labelY = labelPos.actualY !== undefined ? labelPos.actualY : (cityScreenPoint.y + labelPos.offsetY);
    
    const cityX = cityScreenPoint.x;
    const cityY = cityScreenPoint.y;
    const labelRight = labelX + labelWidth;
    const labelBottom = labelY + labelHeight;
    
    // Find the closest point on the label rectangle edge to the city dot
    // This could be on any of the four edges, not just corners
    
    // Calculate the closest point on the label rectangle to the city center
    const closestX = Math.max(labelX, Math.min(cityX, labelRight));
    const closestY = Math.max(labelY, Math.min(cityY, labelBottom));
    
    // If the closest point is inside the rectangle, find the edge point
    let edgeX = closestX;
    let edgeY = closestY;
    
    // Check if closest point is inside the rectangle
    if (closestX > labelX && closestX < labelRight && closestY > labelY && closestY < labelBottom) {
        // Point is inside - find which edge is closest
        const distToLeft = closestX - labelX;
        const distToRight = labelRight - closestX;
        const distToTop = closestY - labelY;
        const distToBottom = labelBottom - closestY;
        
        const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);
        
        if (minDist === distToLeft) {
            edgeX = labelX; // Left edge
        } else if (minDist === distToRight) {
            edgeX = labelRight; // Right edge
        } else if (minDist === distToTop) {
            edgeY = labelY; // Top edge
        } else {
            edgeY = labelBottom; // Bottom edge
        }
    } else {
        // Closest point is already on an edge - use it
        edgeX = closestX;
        edgeY = closestY;
    }
    
    // Calculate direction from city to edge point
    const dx = edgeX - cityX;
    const dy = edgeY - cityY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance === 0) return; // Avoid division by zero
    
    // Normalize direction
    const dirX = dx / distance;
    const dirY = dy / distance;
    
    // Start point: city dot edge (in direction of edge point)
    const lineStartX = cityX + dirX * cityDotRadius;
    const lineStartY = cityY + dirY * cityDotRadius;
    
    // End point: label edge point
    const lineEndX = edgeX;
    const lineEndY = edgeY;
    
    // Convert screen coordinates to lat/lng
    const startLatLng = map.containerPointToLatLng([lineStartX, lineStartY]);
    const endLatLng = map.containerPointToLatLng([lineEndX, lineEndY]);
    
    // Create polyline
    const line = L.polyline([startLatLng, endLatLng], {
        color: '#000000',
        weight: 2,
        opacity: 0.8,
        interactive: false,
        zIndexOffset: -1500 // Below labels
    }).addTo(map);
    
    // Store line for later removal
    labelLines.push(line);
}

// Update map view based on cities, including labels and arrows
function updateMapView() {
    if (cities.length === 0) {
        map.setView([20, 0], 2);
        return;
    }
    
    // Calculate bounds that include all cities, labels, and arrows
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    
    cities.forEach(city => {
        minLat = Math.min(minLat, city.lat);
        maxLat = Math.max(maxLat, city.lat);
        minLon = Math.min(minLon, city.lon);
        maxLon = Math.max(maxLon, city.lon);
    });
    
    // Add padding for labels (approximately 0.5 degrees, which is roughly 50km)
    // This accounts for labels that can extend up to ~100px from the city dot
    const labelPadding = 0.5;
    minLat -= labelPadding;
    maxLat += labelPadding;
    minLon -= labelPadding;
    maxLon += labelPadding;
    
    if (cities.length === 1) {
        // Zoom in on single city with padding for label
        map.setView([cities[0].lat, cities[0].lon], 10, {
            animate: true,
            duration: 1.0
        });
    } else {
        // Fit bounds to show all cities with labels
        const bounds = [[minLat, minLon], [maxLat, maxLon]];
        map.fitBounds(bounds, {
            padding: [80, 80], // Increased padding to account for labels
            animate: true,
            duration: 1.0
        });
    }
}

// Add city to the list
function addCityToList(city) {
    const li = document.createElement('li');
    const dateRange = formatDateRange(city.arriveDate, city.leaveDate);
    const sequence = getCitySequence(city);
    // For display in list: 0→"START", 1→①, 2→②, etc.
    // getCircledNumber converts 0-based sequence to display format
    const displayNumber = sequence !== null ? getCircledNumber(sequence) : '';
    
    li.innerHTML = `
        <div class="city-row">
            <span class="city-name">
                ${displayNumber ? `<span class="city-sequence-number">${displayNumber}</span>` : ''}
                ${city.name}
            </span>
            <button class="remove-btn" data-city="${city.name}">X</button>
        </div>
        ${dateRange ? `<div class="city-dates">${dateRange}</div>` : ''}
    `;
    
    li.querySelector('.remove-btn').addEventListener('click', () => {
        removeCity(city.name);
    });
    
    citiesList.appendChild(li);
}

// Remove city
function removeCity(cityName) {
    const index = cities.findIndex(c => c.name === cityName);
    if (index !== -1) {
        // Remove marker
        map.removeLayer(markers[index]);
        markers.splice(index, 1);
        
        // Remove label position
        labelPositions.splice(index, 1);
        
        // Remove from cities array
        cities.splice(index, 1);
        
        // Update UI
        updateCitiesList();
        updateMapView();
        
        // Redraw everything
        redrawAllMarkers();
    }
}

// Store label markers separately
const labelMarkers = [];

// Redraw all labels after cities and arrows are drawn
function redrawAllLabels() {
    // Prevent multiple simultaneous redraws
    if (isRedrawingLabels) {
        return;
    }
    isRedrawingLabels = true;
    
    // Clear existing label positions and markers
    labelPositions.length = 0;
    labelMarkers.forEach(marker => {
        if (marker && map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });
    labelMarkers.length = 0;
    // Clear label lines
    labelLines.forEach(line => {
        if (line && map.hasLayer(line)) {
            map.removeLayer(line);
        }
    });
    labelLines.length = 0;
    
    // Remove all city markers
    markers.forEach(marker => {
        if (marker && map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });
    markers.length = 0;
    
    // Draw travel routes FIRST (so city dots appear on top)
    drawTravelRoutes();
    
    // Then add all city markers (so they appear above routes)
    cities.forEach(city => {
        const marker = addCityMarker(city, false);
        markers.push(marker);
    });
    
    // Now add labels with improved positioning
    // Use setTimeout to ensure map has rendered cities and routes first
    setTimeout(() => {
        // Clear label positions before recalculating
        labelPositions.length = 0;
        
        // Calculate positions for all cities in order
        // For each city, calculate its position considering already-placed labels
        cities.forEach((city, index) => {
            const labelPos = calculateLabelPosition(city.lat, city.lon);
            // labelPositions is updated by calculateLabelPosition
        });
        
        // If this is a new city (last in array), check if it overlaps with existing labels
        // and reposition those overlapping labels
        if (cities.length > 1) {
            const newCityIndex = cities.length - 1;
            const newLabelPos = labelPositions[newCityIndex];
            if (newLabelPos) {
                repositionOverlappingLabels(newCityIndex, newLabelPos);
            }
        }
        
        // Now create all label markers
        cities.forEach((city, index) => {
            const labelPos = labelPositions[index];
            if (labelPos) {
                const labelMarker = addLabelToMarker(null, city, labelPos);
                if (labelMarker) {
                    labelMarkers.push(labelMarker);
                }
            }
        });
        
        // After all labels are placed, check if any are off-screen and zoom out if needed
        // Only call ensureLabelsVisible if not already in a programmatic zoom
        // This prevents multiple zoom operations from interfering with each other
        if (!isProgrammaticZoom) {
            setTimeout(() => {
                ensureLabelsVisible();
            }, 50);
        }
        
        // Reset the redrawing flag after labels are drawn
        isRedrawingLabels = false;
    }, 100);
}

// Check if any labels are off-screen and zoom out to fit everything
function ensureLabelsVisible() {
    if (cities.length === 0) return;
    // Don't run if we're already in a programmatic zoom (prevents recursive calls)
    if (isProgrammaticZoom) return;
    
    const mapSize = map.getSize();
    const mapBounds = {
        left: 0,
        right: mapSize.x,
        top: 0,
        bottom: mapSize.y
    };
    
    const labelWidth = 120;
    const labelHeight = 40;
    let needsZoomOut = false;
    
    // Check all label positions
    for (const labelPos of labelPositions) {
        const labelX = labelPos.x;
        const labelY = labelPos.y;
        const labelRight = labelX + labelWidth;
        const labelBottom = labelY + labelHeight;
        
        // Check if any part of label is off-screen
        if (labelX < mapBounds.left || labelRight > mapBounds.right ||
            labelY < mapBounds.top || labelBottom > mapBounds.bottom) {
            needsZoomOut = true;
            break;
        }
    }
    
    // Also check city dots and lines
    cities.forEach(city => {
        const screenPoint = map.latLngToContainerPoint([city.lat, city.lon]);
        if (screenPoint.x < mapBounds.left || screenPoint.x > mapBounds.right ||
            screenPoint.y < mapBounds.top || screenPoint.y > mapBounds.bottom) {
            needsZoomOut = true;
        }
    });
    
    if (needsZoomOut) {
        // Set flag to prevent redraw during programmatic zoom
        isProgrammaticZoom = true;
        
        // Calculate bounds that include all cities and labels
        let minLat = Infinity, maxLat = -Infinity;
        let minLon = Infinity, maxLon = -Infinity;
        
        cities.forEach(city => {
            minLat = Math.min(minLat, city.lat);
            maxLat = Math.max(maxLat, city.lat);
            minLon = Math.min(minLon, city.lon);
            maxLon = Math.max(maxLon, city.lon);
        });
        
        // Add padding for labels - use fixed reasonable padding
        // Labels can extend ~150px from city, use consistent padding
        const padding = 0.5; // Fixed 0.5 degrees padding
        
        minLat -= padding;
        maxLat += padding;
        minLon -= padding;
        maxLon += padding;
        
        // Fit bounds to show everything
        const bounds = [[minLat, minLon], [maxLat, maxLon]];
        map.fitBounds(bounds, {
            padding: [80, 80], // Padding in pixels for fitBounds
            animate: true,
            duration: 0.5
        });
        
        // Redraw labels after zoom completes
        // Keep isProgrammaticZoom true during the entire redraw process to prevent zoomend from interfering
        setTimeout(() => {
            redrawAllLabels();
            // After labels are fully redrawn, reset the flag
            setTimeout(() => {
                isProgrammaticZoom = false;
                // Force complete redraw of city markers to fix translucent digits issue
                setTimeout(() => {
                    // Remove and re-add all markers to force complete re-render
                    markers.forEach((marker, index) => {
                        if (marker && map.hasLayer(marker)) {
                            const city = cities[index];
                            if (city) {
                                // Remove old marker
                                map.removeLayer(marker);
                                // Create new marker with fresh icon
                                const newMarker = addCityMarker(city, false);
                                markers[index] = newMarker;
                            }
                        }
                    });
                }, 100);
            }, 400); // Wait longer for labels to be fully drawn before resetting flag
        }, 600); // Wait for zoom animation to complete
    }
}

// Redraw all markers (for map move/zoom)
function redrawAllMarkers() {
    // Clear label positions
    labelPositions.length = 0;
    
    // Remove all markers and labels
    markers.forEach(marker => map.removeLayer(marker));
    markers.length = 0;
    labelMarkers.forEach(marker => {
        if (marker && map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });
    labelMarkers.length = 0;
    // Clear label lines
    labelLines.forEach(line => {
        if (line && map.hasLayer(line)) {
            map.removeLayer(line);
        }
    });
    labelLines.length = 0;
    
    // Draw routes FIRST (so city dots appear on top)
    drawTravelRoutes();
    
    // Then re-add all city markers (so they appear above routes)
    cities.forEach(city => {
        const marker = addCityMarker(city, false);
        markers.push(marker);
    });
    
    // Redraw labels
    setTimeout(() => {
        // Clear label positions again before recalculating
        labelPositions.length = 0;
        cities.forEach(city => {
            const labelPos = calculateLabelPosition(city.lat, city.lon);
            const labelMarker = addLabelToMarker(null, city, labelPos);
            if (labelMarker) {
                labelMarkers.push(labelMarker);
            }
        });
    }, 100);
}

// Merge adjacent identical cities and exact duplicates
function mergeAdjacentCities() {
    if (cities.length < 2) return;
    
    let merged = false;
    
    // First, remove exact duplicates (same name, same coordinates, same dates)
    for (let i = 0; i < cities.length; i++) {
        for (let j = i + 1; j < cities.length; j++) {
            const city1 = cities[i];
            const city2 = cities[j];
            
            // Check if exact duplicate
            if (city1.name.toLowerCase() === city2.name.toLowerCase() &&
                Math.abs(city1.lat - city2.lat) < 0.001 &&
                Math.abs(city1.lon - city2.lon) < 0.001 &&
                city1.arriveDate === city2.arriveDate &&
                city1.leaveDate === city2.leaveDate) {
                
                // Remove the duplicate (keep the first one)
                if (markers[j]) {
                    map.removeLayer(markers[j]);
                    markers.splice(j, 1);
                }
                if (labelMarkers[j]) {
                    if (map.hasLayer(labelMarkers[j])) {
                        map.removeLayer(labelMarkers[j]);
                    }
                    labelMarkers.splice(j, 1);
                }
                if (labelPositions[j]) {
                    labelPositions.splice(j, 1);
                }
                cities.splice(j, 1);
                merged = true;
                break; // Restart check after modification
            }
        }
        if (merged) break;
    }
    
    // Then, merge adjacent cities with same name and consecutive/identical dates
    if (cities.length < 2) return;
    
    // Sort cities by travel order
    const sortedCities = sortCitiesByTravelOrder();
    
    // Check for adjacent cities with the same name
    for (let i = 0; i < sortedCities.length - 1; i++) {
        const current = sortedCities[i];
        const next = sortedCities[i + 1];
        
        // Check if cities have the same name and are adjacent in travel order
        if (current.name.toLowerCase() === next.name.toLowerCase()) {
            // Check if dates are consecutive (next city's arrive date matches or is right after current's leave date)
            const currentLeave = current.leaveDate ? new Date(current.leaveDate) : null;
            const nextArrive = next.arriveDate ? new Date(next.arriveDate) : null;
            
            // Merge if dates are consecutive (within 1 day) OR if dates are identical
            const datesIdentical = current.arriveDate === next.arriveDate && current.leaveDate === next.leaveDate;
            const datesConsecutive = currentLeave && nextArrive && 
                Math.abs((nextArrive - currentLeave) / (1000 * 60 * 60 * 24)) <= 1;
            
            if (datesIdentical || datesConsecutive) {
                // Merge: use earliest arrive date and latest leave date
                const mergedArrive = current.arriveDate && (!next.arriveDate || new Date(current.arriveDate) <= new Date(next.arriveDate))
                    ? current.arriveDate
                    : next.arriveDate;
                const mergedLeave = (current.leaveDate && next.leaveDate && new Date(current.leaveDate) >= new Date(next.leaveDate))
                    ? current.leaveDate
                    : (next.leaveDate || current.leaveDate);
                
                // Find indices in original cities array
                const currentIndex = cities.findIndex(c => 
                    c === current || 
                    (c.name.toLowerCase() === current.name.toLowerCase() && 
                     Math.abs(c.lat - current.lat) < 0.001 && 
                     Math.abs(c.lon - current.lon) < 0.001 &&
                     c.arriveDate === current.arriveDate &&
                     c.leaveDate === current.leaveDate)
                );
                const nextIndex = cities.findIndex(c => 
                    c === next || 
                    (c.name.toLowerCase() === next.name.toLowerCase() && 
                     Math.abs(c.lat - next.lat) < 0.001 && 
                     Math.abs(c.lon - next.lon) < 0.001 &&
                     c.arriveDate === next.arriveDate &&
                     c.leaveDate === next.leaveDate)
                );
                
                if (currentIndex !== -1 && nextIndex !== -1 && currentIndex !== nextIndex) {
                    // Update current city with merged dates
                    cities[currentIndex].arriveDate = mergedArrive;
                    cities[currentIndex].leaveDate = mergedLeave;
                    
                    // Remove marker for next city
                    if (markers[nextIndex]) {
                        map.removeLayer(markers[nextIndex]);
                        markers.splice(nextIndex, 1);
                    }
                    
                    // Remove label marker if exists
                    if (labelMarkers[nextIndex]) {
                        if (map.hasLayer(labelMarkers[nextIndex])) {
                            map.removeLayer(labelMarkers[nextIndex]);
                        }
                        labelMarkers.splice(nextIndex, 1);
                    }
                    
                    // Remove label position
                    if (labelPositions[nextIndex]) {
                        labelPositions.splice(nextIndex, 1);
                    }
                    
                    // Remove from cities array
                    cities.splice(nextIndex, 1);
                    
                    merged = true;
                    break; // Restart merge check after modification
                }
            }
        }
    }
    
    // If merge occurred, recursively check for more merges
    if (merged) {
        mergeAdjacentCities();
    }
}

// Update cities list in UI
function updateCitiesList() {
    // Merge adjacent identical cities first
    mergeAdjacentCities();
    
    citiesList.innerHTML = '';
    cities.forEach(city => addCityToList(city));
    
    // Update arrive date picker state
    updateDatePickerState();
}

// Update date picker state based on cities list
function updateDatePickerState() {
    if (cities.length === 0) {
        arriveDate.disabled = true;
        arriveDate.style.opacity = '0.5';
        arriveDate.style.cursor = 'not-allowed';
        arriveDate.min = '';
        leaveDate.min = '';
    } else {
        arriveDate.disabled = false;
        arriveDate.style.opacity = '1';
        arriveDate.style.cursor = 'default';
        
        // Get the last city's leave date (chronologically)
        const sortedCities = sortCitiesByTravelOrder();
        const lastCity = sortedCities[sortedCities.length - 1];
        
        // Set min date for "Arrive" to be the last city's leave date (or today if no leave date)
        if (lastCity.leaveDate) {
            arriveDate.min = lastCity.leaveDate;
        } else if (lastCity.arriveDate) {
            // If last city has no leave date, use arrive date
            arriveDate.min = lastCity.arriveDate;
        } else {
            // No dates, allow any date from today
            const today = new Date().toISOString().split('T')[0];
            arriveDate.min = today;
        }
        
        // Set min date for "Leave" to be the "Arrive" date (if set), or same as arriveDate.min
        if (arriveDate.value) {
            leaveDate.min = arriveDate.value;
        } else {
            leaveDate.min = arriveDate.min;
        }
    }
}

// Add city function
async function addCity() {
    const cityName = cityInput.value.trim();
    
    if (!cityName) {
        alert('Please enter a city name');
        return;
    }
    
    // Check if city already exists (case-insensitive name check)
    // But allow same city with different dates
    const existingCity = cities.find(c => c.name.toLowerCase() === cityName.toLowerCase());
    if (existingCity) {
        // Check if it's the exact same city with same dates
        const arriveDateValue = arriveDate.value || null;
        const leaveDateValue = leaveDate.value || null;
        if (existingCity.arriveDate === arriveDateValue && existingCity.leaveDate === leaveDateValue) {
            alert('This city with these dates is already on the map');
            cityInput.value = '';
            return;
        }
        // If different dates, allow it (will be merged if adjacent)
    }
    
    // Get date values (optional)
    const arriveDateValue = arriveDate.value || null;
    const leaveDateValue = leaveDate.value || null;
    
    // Validate dates before proceeding
    if (arriveDateValue && arriveDate.min && arriveDateValue < arriveDate.min) {
        alert(`Arrival date must be on or after ${arriveDate.min}`);
        return;
    }
    if (leaveDateValue && arriveDateValue && leaveDateValue < arriveDateValue) {
        alert('Leave date must be on or after arrival date');
        return;
    }
    if (leaveDateValue && leaveDate.min && leaveDateValue < leaveDate.min) {
        alert(`Leave date must be on or after ${leaveDate.min}`);
        return;
    }
    
    // Disable input and button while loading
    cityInput.disabled = true;
    addCityBtn.disabled = true;
    addCityBtn.textContent = 'Loading...';
    cityInput.classList.add('loading');
    
    try {
        const city = await geocodeCity(cityName);
        
        // Add dates to city object
        city.arriveDate = arriveDateValue;
        city.leaveDate = leaveDateValue;
        
        // If the new city has an arrival date, and the last city (chronologically) has no departure date,
        // set the last city's departure date to the new city's arrival date
        if (arriveDateValue && cities.length > 0) {
            const sortedCities = sortCitiesByTravelOrder();
            const lastCity = sortedCities[sortedCities.length - 1];
            if (lastCity && !lastCity.leaveDate) {
                // Set the last city's departure date to the new city's arrival date
                lastCity.leaveDate = arriveDateValue;
                // Find the index of the last city in the original cities array
                const lastCityIndex = cities.findIndex(c => 
                    c.name === lastCity.name && 
                    c.lat === lastCity.lat && 
                    c.lon === lastCity.lon &&
                    c.arriveDate === lastCity.arriveDate
                );
                // Update the marker for the last city if it exists
                if (lastCityIndex >= 0 && markers[lastCityIndex]) {
                    map.removeLayer(markers[lastCityIndex]);
                    markers[lastCityIndex] = addCityMarker(cities[lastCityIndex], false);
                }
            }
        }
        
        // Add to cities array
        cities.push(city);
        
        // Add marker to map (without label first)
        const marker = addCityMarker(city, false);
        markers.push(marker);
        
        // Update map view
        updateMapView();
        
        // Merge adjacent identical cities
        mergeAdjacentCities();
        
        // Update cities list (will also merge)
        updateCitiesList();
        
        // Redraw markers to reflect any merges
        redrawAllMarkers();
        
        // Draw travel routes (arrows)
        drawTravelRoutes();
        
        // Now add labels after everything else is drawn
        // Use a longer timeout to ensure map has fully rendered
        setTimeout(() => {
            redrawAllLabels();
        }, 200);
        
        // Clear input
        cityInput.value = '';
        
        // Auto-fill arrive date with leave date from the city just added
        if (city.leaveDate) {
            arriveDate.value = city.leaveDate;
        } else {
            arriveDate.value = '';
        }
        
        // Clear leave date
        leaveDate.value = '';
        
        // Update date picker constraints
        updateDatePickerState();
    } catch (error) {
        alert(error.message);
    } finally {
        // Re-enable input and button
        cityInput.disabled = false;
        addCityBtn.disabled = false;
        addCityBtn.textContent = 'Add';
        cityInput.classList.remove('loading');
        cityInput.focus();
    }
}

// Clear all cities
function clearAll() {
    if (cities.length === 0) {
        return;
    }
    
    // Remove all markers
    markers.forEach(marker => map.removeLayer(marker));
    markers.length = 0;
    
    // Clear label positions
    labelPositions.length = 0;
    labelMarkers.forEach(marker => map.removeLayer(marker));
    labelMarkers.length = 0;
    // Clear label lines
    labelLines.forEach(line => {
        if (line && map.hasLayer(line)) {
            map.removeLayer(line);
        }
    });
    labelLines.length = 0;
    
    // Clear cities array
    cities.length = 0;
    
    // Update UI
    citiesList.innerHTML = '';
    updateMapView();
    
    // Clear routes
    drawTravelRoutes();
    
    // Update date picker state
    updateDatePickerState();
}

// Test cities list
const testCitiesList = [
    'Paris',
    'Boston',
    'New York',
    'Warsaw',
    'Fukuoka',
    'San Francisco',
    'Rabat',
    'Anghiari',
    'London',
    'Hereford',
    'Îles de la Madeleine',
    'Los Angeles',
    'Kagoshima',
    'Jaipur',
    'Bharatpur',
    'Chipping Camden',
    'Edinburgh',
    // 20 new cities added
    'Tokyo',
    'Sydney',
    'Cairo',
    'Buenos Aires',
    'Istanbul',
    'Mumbai',
    'Bangkok',
    'Dubai',
    'Singapore',
    'Vancouver',
    'Rio de Janeiro',
    'Cape Town',
    'Seoul',
    'Amsterdam',
    'Prague',
    'Vienna',
    'Barcelona',
    'Rome',
    'Athens',
    'Marrakech',
    'Kathmandu'
];

// Japanese prefectural capitals and airports list
const japanCitiesList = [
    // Prefectural capitals (47 prefectures)
    'Sapporo',      // Hokkaido
    'Aomori',       // Aomori
    'Morioka',      // Iwate
    'Sendai',       // Miyagi
    'Akita',        // Akita
    'Yamagata',     // Yamagata
    'Fukushima',    // Fukushima
    'Mito',         // Ibaraki
    'Utsunomiya',   // Tochigi
    'Maebashi',     // Gunma
    'Saitama',      // Saitama
    'Chiba',        // Chiba
    'Tokyo',        // Tokyo
    'Yokohama',     // Kanagawa
    'Niigata',      // Niigata
    'Toyama',       // Toyama
    'Kanazawa',     // Ishikawa
    'Fukui',        // Fukui
    'Kofu',         // Yamanashi
    'Nagano',       // Nagano
    'Gifu',         // Gifu
    'Shizuoka',     // Shizuoka
    'Nagoya',       // Aichi
    'Tsu',          // Mie
    'Otsu',         // Shiga
    'Kyoto',        // Kyoto
    'Osaka',        // Osaka
    'Kobe',         // Hyogo
    'Nara',         // Nara
    'Wakayama',     // Wakayama
    'Tottori',      // Tottori
    'Matsue',       // Shimane
    'Okayama',      // Okayama
    'Hiroshima',    // Hiroshima
    'Yamaguchi',    // Yamaguchi
    'Tokushima',    // Tokushima
    'Takamatsu',    // Kagawa
    'Matsuyama',    // Ehime
    'Kochi',        // Kochi
    'Fukuoka',      // Fukuoka
    'Saga',         // Saga
    'Nagasaki',     // Nagasaki
    'Kumamoto',     // Kumamoto
    'Oita',         // Oita
    'Miyazaki',     // Miyazaki
    'Kagoshima',    // Kagoshima
    'Naha',         // Okinawa
    // Airports
    'Narita',
    'Haneda',
    'Kansai'
];

// Add test cities with consecutive dates
async function addTestCities() {
    if (testCitiesBtn.disabled) return;
    
    // Disable button
    testCitiesBtn.disabled = true;
    testCitiesBtn.textContent = 'Adding...';
    
    // Select 2-5 random cities
    const numCities = Math.floor(Math.random() * 4) + 2; // 2 to 5 cities
    const selectedCities = [];
    const availableCities = [...testCitiesList];
    
    // Exclude cities that are already in the list
    const existingCityNames = cities.map(c => c.name.toLowerCase());
    const filteredCities = availableCities.filter(city => 
        !existingCityNames.includes(city.toLowerCase())
    );
    
    // If we don't have enough cities available, use what we have
    const citiesToSelect = Math.min(numCities, filteredCities.length);
    
    for (let i = 0; i < citiesToSelect; i++) {
        const randomIndex = Math.floor(Math.random() * filteredCities.length);
        selectedCities.push(filteredCities[randomIndex]);
        filteredCities.splice(randomIndex, 1);
    }
    
    // Calculate dates - start from the last city's leave date, or a week from now if no cities
    let currentDate;
    if (cities.length > 0) {
        // Get the last city's leave date (chronologically)
        const sortedCities = sortCitiesByTravelOrder();
        const lastCity = sortedCities[sortedCities.length - 1];
        if (lastCity.leaveDate) {
            currentDate = new Date(lastCity.leaveDate);
            currentDate.setDate(currentDate.getDate() + 1); // Start day after last city's leave date
        } else {
            // Last city has no leave date, use arrive date or default
            currentDate = lastCity.arriveDate ? new Date(lastCity.arriveDate) : new Date();
            currentDate.setDate(currentDate.getDate() + 1);
        }
    } else {
        // No cities yet, start a week from now
        currentDate = new Date();
        currentDate.setDate(currentDate.getDate() + 7);
    }
    
    try {
        for (let i = 0; i < selectedCities.length; i++) {
            const cityName = selectedCities[i];
            
            // Random days between 1 and 7
            const days = Math.floor(Math.random() * 7) + 1;
            
            // Set arrive date
            const arriveDateStr = currentDate.toISOString().split('T')[0];
            
            // Set leave date (days after arrive)
            const leaveDate = new Date(currentDate);
            leaveDate.setDate(leaveDate.getDate() + days);
            const leaveDateStr = leaveDate.toISOString().split('T')[0];
            
            // Geocode city
            const city = await geocodeCity(cityName);
            city.arriveDate = arriveDateStr;
            city.leaveDate = leaveDateStr;
            
            // Add to cities array
            cities.push(city);
            
        // Add marker to map (without label)
        const marker = addCityMarker(city, false);
        markers.push(marker);
        
        // Update current date for next city (leave date + 1 day travel)
        currentDate = new Date(leaveDate);
        currentDate.setDate(currentDate.getDate() + 1);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Merge adjacent identical cities
    mergeAdjacentCities();
    
    // Update cities list (will also merge)
    updateCitiesList();
    
    // Redraw markers to reflect any merges
    redrawAllMarkers();
    
    // Update map view
    updateMapView();
    
    // Draw travel routes
    drawTravelRoutes();
    
    // Add labels after everything is drawn
    setTimeout(() => {
        redrawAllLabels();
    }, 200);
    
    // Prefill arrive date with leave date from the last city added
    if (cities.length > 0) {
        const sortedCities = sortCitiesByTravelOrder();
        const lastCity = sortedCities[sortedCities.length - 1];
        if (lastCity.leaveDate) {
            arriveDate.value = lastCity.leaveDate;
        } else {
            arriveDate.value = '';
        }
        // Update date picker constraints
        updateDatePickerState();
    }
        
    } catch (error) {
        alert(`Error adding test cities: ${error.message}`);
    } finally {
        // Re-enable button
        testCitiesBtn.disabled = false;
        testCitiesBtn.textContent = 'TEST';
    }
}

// Add Japanese cities with consecutive dates
async function addTestJapanCities() {
    const testJapanBtn = document.getElementById('testJapanBtn');
    if (testJapanBtn.disabled) return;
    
    // Disable button
    testJapanBtn.disabled = true;
    testJapanBtn.textContent = 'Adding...';
    testJapanBtn.classList.add('adding');
    
    // Select 2-5 random cities
    const numCities = Math.floor(Math.random() * 4) + 2; // 2 to 5 cities
    const selectedCities = [];
    const availableCities = [...japanCitiesList];
    
    // Exclude cities that are already in the list
    const existingCityNames = cities.map(c => c.name.toLowerCase());
    const filteredCities = availableCities.filter(city => 
        !existingCityNames.includes(city.toLowerCase())
    );
    
    // If we don't have enough cities available, use what we have
    const citiesToSelect = Math.min(numCities, filteredCities.length);
    
    for (let i = 0; i < citiesToSelect; i++) {
        const randomIndex = Math.floor(Math.random() * filteredCities.length);
        selectedCities.push(filteredCities[randomIndex]);
        filteredCities.splice(randomIndex, 1);
    }
    
    // Calculate dates - start from the last city's leave date, or a week from now if no cities
    let currentDate;
    if (cities.length > 0) {
        // Get the last city's leave date (chronologically)
        const sortedCities = sortCitiesByTravelOrder();
        const lastCity = sortedCities[sortedCities.length - 1];
        if (lastCity.leaveDate) {
            currentDate = new Date(lastCity.leaveDate);
            currentDate.setDate(currentDate.getDate() + 1); // Start day after last city's leave date
        } else {
            // Last city has no leave date, use arrive date or default
            currentDate = lastCity.arriveDate ? new Date(lastCity.arriveDate) : new Date();
            currentDate.setDate(currentDate.getDate() + 1);
        }
    } else {
        // No cities yet, start a week from now
        currentDate = new Date();
        currentDate.setDate(currentDate.getDate() + 7);
    }
    
    try {
        for (let i = 0; i < selectedCities.length; i++) {
            const cityName = selectedCities[i];
            
            // Random days between 1 and 7
            const days = Math.floor(Math.random() * 7) + 1;
            
            // Set arrive date
            const arriveDateStr = currentDate.toISOString().split('T')[0];
            
            // Set leave date (days after arrive)
            const leaveDate = new Date(currentDate);
            leaveDate.setDate(leaveDate.getDate() + days);
            const leaveDateStr = leaveDate.toISOString().split('T')[0];
            
            // Geocode city in Japan (ensures we get Japanese cities, not cities with same name elsewhere)
            const city = await geocodeCityInJapan(cityName);
            city.arriveDate = arriveDateStr;
            city.leaveDate = leaveDateStr;
            
            // Add to cities array
            cities.push(city);
            
            // Add marker to map (without label)
            const marker = addCityMarker(city, false);
            markers.push(marker);
            
            // Update current date for next city (leave date + 1 day travel)
            currentDate = new Date(leaveDate);
            currentDate.setDate(currentDate.getDate() + 1);
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Merge adjacent identical cities
        mergeAdjacentCities();
        
        // Update cities list (will also merge)
        updateCitiesList();
        
        // Redraw markers to reflect any merges
        redrawAllMarkers();
        
        // Update map view
        updateMapView();
        
        // Draw travel routes
        drawTravelRoutes();
        
        // Add labels after everything is drawn
        setTimeout(() => {
            redrawAllLabels();
            ensureLabelsVisible();
        }, 200);
        
        // Prefill arrive date with leave date from the last city added
        if (cities.length > 0) {
            const sortedCities = sortCitiesByTravelOrder();
            const lastCity = sortedCities[sortedCities.length - 1];
            if (lastCity.leaveDate) {
                arriveDate.value = lastCity.leaveDate;
            } else {
                arriveDate.value = '';
            }
            // Update date picker constraints
            updateDatePickerState();
        }
        
    } catch (error) {
        alert(`Error adding Japanese cities: ${error.message}`);
    } finally {
        // Re-enable button
        testJapanBtn.disabled = false;
        testJapanBtn.textContent = '日本';
        testJapanBtn.classList.remove('adding');
    }
}

// Event listeners
addCityBtn.addEventListener('click', addCity);
clearBtn.addEventListener('click', clearAll);
testCitiesBtn.addEventListener('click', addTestCities);
document.getElementById('testJapanBtn').addEventListener('click', addTestJapanCities);

cityInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        addCity();
    }
});

// Flag to prevent redraw during programmatic zoom
let isProgrammaticZoom = false;
let isRedrawingLabels = false; // Prevent multiple simultaneous label redraws

// Update label positions on map move/zoom
map.on('moveend', () => {
    if (cities.length > 0 && !isProgrammaticZoom) {
        redrawAllMarkers();
        // Force opacity fix for digits after move
        setTimeout(() => {
            fixMarkerOpacity();
        }, 50);
    }
    // Don't reset isProgrammaticZoom here - let ensureLabelsVisible handle it
});

map.on('zoomend', () => {
    // Only redraw if this is a user-initiated zoom, not programmatic
    if (cities.length > 0 && !isProgrammaticZoom) {
        redrawAllMarkers();
        // Force opacity fix for digits after zoom
        setTimeout(() => {
            fixMarkerOpacity();
        }, 50);
    }
    // Don't reset isProgrammaticZoom here - let ensureLabelsVisible handle it
});

// Force markers to be fully opaque (fixes browser rendering bug)
function fixMarkerOpacity() {
    markers.forEach(marker => {
        if (marker && map.hasLayer(marker)) {
            const element = marker.getElement();
            if (element) {
                // Force opacity on the marker element and all children
                element.style.opacity = '1';
                const children = element.querySelectorAll('*');
                children.forEach(child => {
                    if (child.classList.contains('city-sequence') || child.classList.contains('city-dot')) {
                        child.style.opacity = '1';
                        child.style.color = 'white';
                    }
                });
            }
        }
    });
}

// Initialize date picker state
updateDatePickerState();

// Add event listeners to update date constraints when dates change
arriveDate.addEventListener('change', () => {
    // When arrive date changes, update leave date min to match
    if (arriveDate.value) {
        leaveDate.min = arriveDate.value;
        // If leave date is now invalid, clear it
        if (leaveDate.value && leaveDate.value < arriveDate.value) {
            leaveDate.value = '';
        }
    } else {
        // If arrive date is cleared, update leave date min based on last city
        updateDatePickerState();
    }
});

// Focus input on load
cityInput.focus();
