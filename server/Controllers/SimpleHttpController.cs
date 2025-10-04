using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;

namespace MeshokParser.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SimpleHttpController : ControllerBase
    {
        private readonly HttpClient _httpClient;

        public SimpleHttpController(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        [HttpGet("fetch")]
        public async Task<IActionResult> FetchUrl([FromQuery] string url)
        {
            if (string.IsNullOrEmpty(url))
            {
                return BadRequest("URL parameter is required");
            }

            try
            {
                // Простой HTTP запрос без Chrome DevTools
                var response = await _httpClient.GetAsync(url);
                
                if (!response.IsSuccessStatusCode)
                {
                    return StatusCode(500, $"Failed to fetch URL: {response.StatusCode}");
                }

                var content = await response.Content.ReadAsStringAsync();

                // Проверяем на Cloudflare
                if (content.Contains("Just a moment") || content.Contains("Один момент") || content.Contains("Cloudflare"))
                {
                    return Ok(new
                    {
                        success = false,
                        message = "Cloudflare challenge detected",
                        html = content.Substring(0, Math.Min(1000, content.Length)),
                        timestamp = System.DateTime.UtcNow,
                        method = "direct_http"
                    });
                }

                return Ok(new
                {
                    success = true,
                    url = url,
                    html = content,
                    timestamp = System.DateTime.UtcNow,
                    method = "direct_http"
                });
            }
            catch (System.Exception ex)
            {
                return StatusCode(500, new
                {
                    success = false,
                    error = ex.Message
                });
            }
        }
    }
}
